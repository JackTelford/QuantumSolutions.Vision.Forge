/**
 * The post pipeline (lanes/capabilities-and-limits.md): an EffectComposer
 * over a half-float target with supersampling, bloom when the look has
 * halation, the thin-lens bokeh of camera/bokeh.ts and the OutputPass
 * that tone maps and encodes sRGB; then the sub-frame accumulation of
 * ADR 0008 decision 1: every sub-frame of a frame is rendered through the
 * composer and added into a float target with weight 1 / N, and the sum
 * is copied to the canvas once per frame. Nothing here keeps time: the
 * composer is given the frame interval, never a clock.
 */
import { AddEquation, Color, CustomBlending, FloatType, HalfFloatType, NearestFilter, OneFactor, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import type { BokehParameters } from '../../shared/camera/bokeh.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { ssaaSampleLevel } from '../../shared/three/quality.ts';

/** The bloom's strength per unit of the look's halationAmount. */
export const bloomStrengthPerHalation = 0.6;

/** The bloom's radius. */
export const bloomRadius = 0.4;

/** The bloom's threshold on the scene-linear output: only highlights bleed. */
export const bloomThreshold = 0.9;

/** The uniform values a BokehPass exposes; the addon types them as a bare object. */
interface BokehUniforms {
  readonly focus: { value: number };
  readonly aperture: { value: number };
  readonly maxblur: { value: number };
}

const accumulateVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const accumulateFragmentShader = `
uniform sampler2D tDiffuse;
uniform float weight;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv) * weight;
}`;

/**
 * Adds the composer's current output into a float target with a weight,
 * through one-plus-one blending; the target is cleared to black before
 * the first sub-frame of a frame. The pass writes nothing to the
 * composer's buffers (needsSwap false).
 */
export class AccumulatePass extends Pass {
  /** The running sum of the sub-frames of the current frame. */
  readonly target: WebGLRenderTarget;
  /** Set before each render: the sub-frame's share, 1 / N. */
  weight = 1;
  /** Set before each render: true clears the sum first (the frame's first sub-frame). */
  clearFirst = true;
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly black: Color;

  /** A pass whose sum target is width x height, 32-bit float, without depth. */
  constructor(width: number, height: number) {
    super();
    this.needsSwap = false;
    // Nearest filtering: the present copy reads the sum 1:1, and linear filtering of a float texture needs OES_texture_float_linear, which a software renderer may lack (the texture would be incomplete and the frame black).
    this.target = new WebGLRenderTarget(width, height, { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false });
    this.target.texture.name = 'AccumulatePass.sum';
    this.material = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, weight: { value: 1 } },
      vertexShader: accumulateVertexShader,
      fragmentShader: accumulateFragmentShader,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.quad = new FullScreenQuad(this.material);
    this.black = new Color(0, 0, 0);
  }

  /** Adds readBuffer × weight into the target. */
  override render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const tDiffuse = this.material.uniforms['tDiffuse'];
    const weight = this.material.uniforms['weight'];
    if (tDiffuse !== undefined) tDiffuse.value = readBuffer.texture;
    if (weight !== undefined) weight.value = this.weight;
    // The quad draws through renderer.render, which clears the target first while autoClear is on; the sum must survive it.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    if (this.clearFirst) {
      const previous = new Color();
      renderer.getClearColor(previous);
      const previousAlpha = renderer.getClearAlpha();
      renderer.setClearColor(this.black, 0);
      renderer.clear(true, false, false);
      renderer.setClearColor(previous, previousAlpha);
    }
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  /** Resizes the sum. */
  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  /** Frees the target, the material and the quad. */
  override dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

/** The composer, its passes and the final copy to the canvas, for one shot. */
export class PostPipeline {
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bokeh: BokehPass;
  private readonly accumulate: AccumulatePass;
  private readonly present: FullScreenQuad;
  private readonly presentMaterial: ShaderMaterial;
  private readonly frameSeconds: number;

  /** Builds the passes in order: SSAA, bloom (only with halation), bokeh, output, accumulate. */
  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, spec: ShotPageSpec) {
    this.renderer = renderer;
    this.frameSeconds = 1 / spec.fps;
    const { width, height } = spec;
    this.composer = new EffectComposer(renderer, new WebGLRenderTarget(width, height, { type: HalfFloatType }));
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    // The output lands in the accumulation target, never on the canvas straight from a pass.
    this.composer.renderToScreen = false;

    const ssaa = new SSAARenderPass(scene, camera);
    ssaa.sampleLevel = ssaaSampleLevel(width);
    ssaa.unbiased = true;
    this.composer.addPass(ssaa);

    const halation = spec.look.grade.halationAmount;
    if (halation > 0) this.composer.addPass(new UnrealBloomPass(new Vector2(width, height), halation * bloomStrengthPerHalation, bloomRadius, bloomThreshold));

    this.bokeh = new BokehPass(scene, camera, { focus: 1, aperture: 0, maxblur: 0 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    this.accumulate = new AccumulatePass(width, height);
    this.composer.addPass(this.accumulate);

    this.presentMaterial = new ShaderMaterial({ uniforms: UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false });
    const tDiffuse = this.presentMaterial.uniforms['tDiffuse'];
    if (tDiffuse !== undefined) tDiffuse.value = this.accumulate.target.texture;
    this.present = new FullScreenQuad(this.presentMaterial);
  }

  /** Sets the bokeh's focus, aperture and blur cap from the thin lens for this (sub-)frame. */
  setBokeh(parameters: BokehParameters): void {
    const uniforms = this.bokeh.uniforms as BokehUniforms;
    uniforms.focus.value = parameters.focusM;
    uniforms.aperture.value = parameters.aperture;
    uniforms.maxblur.value = parameters.maxBlur;
  }

  /** Renders the scene as it stands through the composer and adds it into the frame's sum with the weight; `first` clears the sum. */
  renderSubFrame(first: boolean, weight: number): void {
    this.accumulate.clearFirst = first;
    this.accumulate.weight = weight;
    this.composer.render(this.frameSeconds);
  }

  /** Copies the frame's sum to the canvas. */
  presentFrame(): void {
    this.renderer.setRenderTarget(null);
    this.present.render(this.renderer);
  }

  /** Frees every pass's targets and materials (the composer disposes only its own two buffers), the sum and the present quad. */
  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.presentMaterial.dispose();
    this.present.dispose();
  }
}
