/**
 * The three lane's WebGLRenderer and camera. The renderer draws on one
 * canvas of the frame's size at the root's top-left (ADR 0006 decision 2:
 * no antialias, no alpha, the drawing buffer preserved for the
 * screenshot), outputs sRGB and tone maps per the look. The camera is a
 * 36 mm film gauge PerspectiveCamera that reads a baked frame through
 * shared/three/camera-mapping.ts, so what three draws is what project.ts
 * computes.
 */
import { AgXToneMapping, LinearToneMapping, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from 'three';
import type { ToneMapping } from '../../shared/contracts/look-bible.ts';
import type { ShotPageSpec } from '../../shared/harness/protocol.ts';
import { filmGaugeMm } from '../../shared/three/camera-mapping.ts';
import type { ThreeCameraPose } from '../../shared/three/camera-mapping.ts';

/**
 * three's tone mapping constant for a look's token: AgX for photographic
 * looks, and for the graphic looks' 'standard' (no tone curve,
 * look-bible.md) LinearToneMapping rather than NoToneMapping. The
 * OutputPass applies toneMappingExposure only inside a tone mapping
 * function, so with NoToneMapping the look's and the shot's EV would be
 * ignored; LinearToneMapping is saturate(exposure × colour), the same
 * picture as none at 0 EV (the 8-bit canvas clamps at 1 anyway) with the
 * exposure applied.
 */
export function toneMappingOf(token: ToneMapping): typeof AgXToneMapping | typeof LinearToneMapping {
  return token === 'agx' ? AgXToneMapping : LinearToneMapping;
}

/**
 * Creates the renderer on a new canvas under the root. The canvas is the
 * only thing on the page: absolutely at the top-left, the frame's size,
 * no margin, so the screenshot's clip is the drawing buffer.
 */
export function createRenderer(root: HTMLElement, spec: ShotPageSpec): WebGLRenderer {
  const canvas = root.ownerDocument.createElement('canvas');
  canvas.style.cssText = 'display: block; position: absolute; left: 0; top: 0; margin: 0; padding: 0';
  root.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(spec.width, spec.height, true);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = toneMappingOf(spec.look.toneMapping);
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in r186 (three falls back to PCF with a console warning); PCF is the filtered map that remains.
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

/** A camera with the 36 mm film gauge of ADR 0008; its lens and pose are set per frame by applyCameraPose. */
export function createCamera(spec: ShotPageSpec): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, spec.width / spec.height);
  camera.filmGauge = filmGaugeMm;
  return camera;
}

/** Puts the camera at a pose: position, quaternion, the focal length through setFocalLength (which sets the fov), near and far; then updates its matrices. */
export function applyCameraPose(camera: PerspectiveCamera, pose: ThreeCameraPose): void {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
  camera.aspect = pose.aspect;
  camera.near = pose.nearM;
  camera.far = pose.farM;
  // setFocalLength derives the vertical fov from the 36 mm gauge and calls updateProjectionMatrix.
  camera.setFocalLength(pose.focalMm);
  camera.updateMatrixWorld(true);
}
