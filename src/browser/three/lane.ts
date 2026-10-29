/**
 * The three lane: a WebGL scene of the shot's subject (or the calibration
 * scene) on a cyclorama under the shot's lighting rig, seen through the
 * shared camera, rendered with supersampling, bloom, bokeh and sub-frame
 * motion blur, tone mapped per the look. init builds everything and
 * awaits the environment map; render(frame) sets the camera, the lights,
 * the subject and the motes from the baked frame and its sub-frames and
 * draws, synchronously, with no loop and no clock (ADR 0006).
 *
 * Text elements of a three shot are not rendered here: text is the html
 * lane's and is composited over the picture plate at assembly (M7, ADR
 * 0008 decision 4), so the lane measures no text and the InitReport's
 * textOverflows stays empty.
 */
import { DirectionalLight, Mesh, Points } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { bokehParameters } from '../../shared/camera/bokeh.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { threeCameraPose } from '../../shared/three/camera-mapping.ts';
import { toneMappingExposure } from '../../shared/three/exposure.ts';
import { subFrameCount } from '../../shared/three/quality.ts';
import { floorY } from '../../shared/three/stage.ts';
import { subFrameCamera, subFrameOffsets } from '../../shared/three/sub-frame.ts';
import type { LaneModule } from '../runtime/lane-module.ts';
import { rendererStringOf } from '../runtime/webgl-renderer.ts';
import { Atmosphere } from './atmosphere.ts';
import { CalibrationStage } from './calibration.ts';
import { installEnvironment } from './environment.ts';
import type { EnvironmentSource } from './environment.ts';
import { RigLights } from './lights.ts';
import { PostPipeline } from './post.ts';
import { applyCameraPose, createCamera, createRenderer } from './renderer.ts';
import { buildStage, createScene } from './scene.ts';
import { Subject } from './subject.ts';

/** Everything init built, kept for render. */
interface Built {
  readonly spec: ShotPageSpec;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly lights: RigLights;
  readonly subject: Subject | CalibrationStage;
  readonly atmosphere: Atmosphere;
  readonly post: PostPipeline;
}

/** The three lane. */
export class ThreeLane implements LaneModule {
  /** Which environment map the scene got: the spec's HDRI or the built-in room; null before init. */
  environmentSource: EnvironmentSource | null = null;
  private built: Built | undefined = undefined;

  /** Builds the renderer, the scene, the lights, the subject or the calibration stage, the atmosphere and the post pipeline, then awaits the environment map. */
  async init(spec: ShotPageSpec, root: HTMLElement): Promise<void> {
    this.dispose();
    root.replaceChildren();
    const renderer = createRenderer(root, spec);
    const camera = createCamera(spec);
    const scene = createScene(spec);
    const calibration = spec.scene === 'calibration';
    // The calibration scene stands on nothing: the rest of its frame is the look's background in both lanes.
    if (!calibration) buildStage(scene, spec, floorY(spec.shot.subject.boundsM));
    const lights = new RigLights(scene, spec);
    const subject = calibration ? new CalibrationStage(scene, spec) : new Subject(scene, spec);
    const atmosphere = new Atmosphere(scene, spec);
    this.environmentSource = await installEnvironment(renderer, scene, spec.environment);
    const post = new PostPipeline(renderer, scene, camera, spec);
    this.built = { spec, renderer, scene, camera, lights, subject, atmosphere, post };
  }

  /**
   * Draws the frame: N sub-frames across the shutter window (one at the
   * fast width), each with the camera, the subject, the key orbit and the
   * motes at its fractional time, averaged into the canvas. Throws when
   * init has not run or the frame has no baked camera.
   */
  render(frame: number): void {
    const built = this.built;
    if (built === undefined) throw new Error('The three lane has not been initialised.');
    const { spec } = built;
    const first = spec.camera[frame];
    if (first === undefined) throw new Error(`Frame ${String(frame)} has no baked camera; the shot has ${String(spec.camera.length)} frames.`);
    const aspect = spec.width / spec.height;
    const bounds = spec.shot.subject.boundsM;
    const count = subFrameCount(first.shutterAngleDeg, spec.width);
    const offsets = subFrameOffsets(first.shutterAngleDeg, count);
    offsets.forEach((offset, index) => {
      const sub = subFrameCamera(spec.camera, frame, offset);
      applyCameraPose(built.camera, threeCameraPose(sub, aspect, bounds));
      built.lights.update(sub.keyLightOrbitDeg);
      built.subject.update(sub);
      built.atmosphere.update(frame + offset);
      built.renderer.toneMappingExposure = toneMappingExposure(spec.look, sub);
      built.post.setBokeh(bokehParameters(sub.focalMm, sub.fStop, sub.focusDistanceM, aspect));
      built.post.renderSubFrame(index === 0, 1 / count);
    });
    built.post.presentFrame();
  }

  /** The renderer string of the context that draws the frames; null before init. */
  webglRenderer(): string | null {
    return this.built === undefined ? null : rendererStringOf(this.built.renderer.getContext());
  }

  /** Frees the GPU side of a built lane: every geometry, material and shadow map, the environment map, the post pipeline's targets, then the renderer and its context. A no-op before init. */
  dispose(): void {
    const built = this.built;
    if (built === undefined) return;
    this.built = undefined;
    this.environmentSource = null;
    built.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        object.geometry.dispose();
        // Every mesh here has one material; the subject's parts share theirs, and a second dispose is harmless.
        if (!Array.isArray(object.material)) object.material.dispose();
      }
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    built.scene.environment?.dispose();
    built.post.dispose();
    built.renderer.dispose();
    built.renderer.forceContextLoss();
  }
}
