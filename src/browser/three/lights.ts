/**
 * The shot's lighting rig as three lights (lighting/cookbook.md, the
 * per-lane mapping): one RectAreaLight per placed light of the rig, a
 * DirectionalLight along the key for the shadow (RectAreaLights cast
 * none) and the environment intensity. The placement is the shared one
 * (lighting/placement.ts); update(keyOrbitDeg) moves the key and the fill
 * with the light-sweep move every (sub-)frame.
 */
import { Color, DirectionalLight, RectAreaLight, SRGBColorSpace } from 'three';
import type { Scene } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { Vector3 } from '../../shared/camera/types.ts';
import type { ToneMapping } from '../../shared/contracts/look-bible.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { cameraAzimuthDeg, lightDistanceM, placeRig } from '../../shared/lighting/placement.ts';
import type { PlacedLight, PlacedRig } from '../../shared/lighting/placement.ts';
import { shotLightingRig } from '../../shared/lighting/rigs.ts';
import type { LightingRig } from '../../shared/lighting/rigs.ts';
import { environmentIntensityOf, placedLightRgb, placedRigWhiteBalanceKelvin, rectAreaIntensity, shadowBoxHalfM, shadowCameraRange, shadowLightSettings, shadowMapSize, shadowNormalBias } from '../../shared/three/lights.ts';

let uniformsInitialised = false;

/** The LTC lookup textures every RectAreaLight shader needs, built once per page. */
function initRectAreaUniforms(): void {
  if (uniformsInitialised) return;
  RectAreaLightUniformsLib.init();
  uniformsInitialised = true;
}

/** The colour of a placed light under the rig's white balance as a three Color: its sRGB channels converted to the working space. */
function lightColor(light: PlacedLight, whiteBalanceKelvin: number): Color {
  const rgb = placedLightRgb(light, whiteBalanceKelvin);
  return new Color().setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, SRGBColorSpace);
}

function setPosition(target: { position: { set(x: number, y: number, z: number): unknown } }, point: Vector3): void {
  target.position.set(point.x, point.y, point.z);
}

/** The lights of one shot, placed around the subject and moved by the key orbit. */
export class RigLights {
  private readonly rig: LightingRig;
  private readonly cameraAzimuth: number;
  private readonly subjectHeightM: number;
  private readonly toneMapping: ToneMapping;
  private readonly areaLights: Map<string, RectAreaLight>;
  private readonly shadowLight: DirectionalLight | null;

  /** Builds the rig's lights for the spec's first camera frame and adds them to the scene. */
  constructor(scene: Scene, spec: ShotPageSpec) {
    initRectAreaUniforms();
    this.rig = shotLightingRig(spec.shot.lighting);
    const first = spec.camera[0];
    this.cameraAzimuth = first === undefined ? 0 : cameraAzimuthDeg(first.position);
    this.subjectHeightM = spec.shot.subject.boundsM.h;
    this.toneMapping = spec.look.toneMapping;
    this.areaLights = new Map();
    const placed = placeRig(this.rig, this.cameraAzimuth, this.subjectHeightM, 0);
    const whiteBalanceKelvin = placedRigWhiteBalanceKelvin(placed);
    for (const light of placedLightsOf(placed)) {
      const area = new RectAreaLight(lightColor(light, whiteBalanceKelvin), rectAreaIntensity(light, this.toneMapping), light.sizeM, light.sizeM);
      area.name = light.name;
      scene.add(area);
      this.areaLights.set(light.name, area);
    }
    this.shadowLight = buildShadowLight(scene, placed, whiteBalanceKelvin, this.subjectHeightM, this.toneMapping);
    scene.environmentIntensity = environmentIntensityOf(placed);
    this.update(0);
  }

  /** Places every light for the frame's key orbit: the key and the fill turn, the rims stay, the shadow follows the key. */
  update(keyOrbitDeg: number): void {
    const placed = placeRig(this.rig, this.cameraAzimuth, this.subjectHeightM, keyOrbitDeg);
    for (const light of placedLightsOf(placed)) {
      const area = this.areaLights.get(light.name);
      if (area === undefined) continue;
      setPosition(area, light.position);
      area.lookAt(light.target.x, light.target.y, light.target.z);
    }
    const shadow = shadowLightSettings(placed, this.toneMapping);
    if (this.shadowLight !== null && shadow !== null) {
      setPosition(this.shadowLight, shadow.position);
      setPosition(this.shadowLight.target, shadow.target);
      this.shadowLight.target.updateMatrixWorld(true);
    }
  }
}

/** The placed lights of a rig in a fixed order: key, fill, then the rims. */
function placedLightsOf(placed: PlacedRig): readonly PlacedLight[] {
  const lights: PlacedLight[] = [];
  if (placed.key !== null) lights.push(placed.key);
  if (placed.fill !== null) lights.push(placed.fill);
  lights.push(...placed.rims);
  return lights;
}

/** The shadow-casting directional light along the key with a shadow box around the anchor sized to the subject; null for a rig without a key. */
function buildShadowLight(scene: Scene, placed: PlacedRig, whiteBalanceKelvin: number, subjectHeightM: number, toneMapping: ToneMapping): DirectionalLight | null {
  const settings = shadowLightSettings(placed, toneMapping);
  if (settings === null || placed.key === null) return null;
  const light = new DirectionalLight(lightColor(placed.key, whiteBalanceKelvin), settings.intensity);
  light.name = 'key-shadow';
  light.castShadow = true;
  light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  light.shadow.normalBias = shadowNormalBias;
  const range = shadowCameraRange(lightDistanceM(subjectHeightM), subjectHeightM);
  const half = shadowBoxHalfM(subjectHeightM);
  const box = light.shadow.camera;
  box.left = -half;
  box.right = half;
  box.top = half;
  box.bottom = -half;
  box.near = range.near;
  box.far = range.far;
  box.updateProjectionMatrix();
  scene.add(light);
  scene.add(light.target);
  return light;
}
