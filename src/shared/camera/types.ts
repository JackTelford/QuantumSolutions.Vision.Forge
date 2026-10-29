/**
 * The data types of the camera module: vectors and quaternions in world
 * space, the pose the composition solver hands to the baker, and the fully
 * resolved camera of one frame that every lane renders from (ADR 0008).
 *
 * World space is right-handed with +Y up, +X right and +Z toward the viewer.
 * The subject's anchor (the centre of its bounding box) sits at the origin.
 * The camera's local forward is -Z and its local up is +Y (the three.js and
 * Blender convention). Blender's world is Z-up: the blender lane converts
 * world position and rotation (x, y, z) -> (x, -z, y) (the quaternion's
 * vector part maps the same way, w unchanged) before writing scene.json;
 * the camera-local convention needs no change. Angles are degrees in data;
 * radians live only inside formulas. Frames are integers counted from 0
 * within a shot.
 */
import type { EasingToken, Lane } from '../contracts/shot-spec.ts';

/** A point or a direction in world space, in metres. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A unit quaternion {x, y, z, w} = (sin(θ/2)·axis, cos(θ/2)) describing a rotation. */
export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** An offset of the 2.5D stage as fractions of its width (x) and height (y); 0 means no offset. */
export interface StageOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the camera sits before any move (the composition solver's answer):
 * its position and the point it looks at in metres, the dutch roll in degrees
 * (positive tilts the horizon clockwise) and its distance to the target in
 * metres, which the dolly moves and the focus plane are measured against.
 */
export interface BasePose {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly rollDeg: number;
  readonly distanceM: number;
}

/**
 * The resolved camera of one frame. Every lane maps it the same way: the
 * three lane sets filmGauge 36 and setFocalLength, Blender sets sensor_width
 * 36 and lens, the html lane derives its CSS perspective from the vertical
 * field of view.
 */
export interface CameraFrame {
  /** Frame number within the shot, counted from 0. */
  readonly frame: number;
  /** Camera position in world space, metres. */
  readonly position: Vector3;
  /** Camera orientation: local -Z is the view direction, local +Y the top of the picture. */
  readonly rotation: Quaternion;
  /** Focal length in millimetres on a 36 mm sensor (larger image axis). */
  readonly focalMm: number;
  /** Aperture as an f-number. */
  readonly fStop: number;
  /** Distance from the camera to the plane in focus, metres. */
  readonly focusDistanceM: number;
  /** Shutter angle in degrees; 180 is the cinema standard. */
  readonly shutterAngleDeg: number;
  /** Exposure offset in EV stops relative to the look bible's base exposure. */
  readonly exposureEv: number;
  /** Rotation of the subject about world +Y in degrees for the turntable move, else 0. */
  readonly subjectRotationDeg: number;
  /** Orbit of the key light about the subject in degrees for the light-sweep move, else 0. */
  readonly keyLightOrbitDeg: number;
  /** Slide of the 2.5D stage for the parallax-drift move as fractions of the stage, else 0. */
  readonly stageOffset: StageOffset;
}

/** The frame rate and pixel size a bake is measured against; a ShotSpec satisfies it. */
export interface RenderSpec {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

/** The unit of a move's cap, as camera-moves.md names it. */
export type MoveUnit =
  | 'none'
  | 'distance-fraction'
  | 'subject-width-fraction'
  | 'subject-height-fraction'
  | 'degrees'
  | 'focal-multiplier'
  | 'focus-travel-fraction'
  | 'stage-width-fraction';

/** One row of the move catalogue in camera-moves.md. */
export interface MoveDefinition {
  /** The travel at amplitude 1, in `unit`: a fraction, degrees or a multiplier of the focal length. */
  readonly cap: number;
  readonly unit: MoveUnit;
  /** The easing the planner fills in when the shot names none. */
  readonly defaultEasing: EasingToken;
  /** The lanes that can render the move. */
  readonly lanes: readonly Lane[];
  /** True for the transition moves (whip-pan, crash-zoom) that accelerate into the cut instead of settling. */
  readonly endsAtCut: boolean;
  readonly description: string;
}

/** The azimuth and elevation of a camera angle on the sphere around the subject, in degrees. */
export interface AnglePlacement {
  /** Rotation about world +Y from the +Z axis, positive toward +X (counter-clockwise seen from above). */
  readonly azimuthDeg: number;
  /** Height above the horizontal plane through the target; positive puts the camera above it, 90 is straight down. */
  readonly elevationDeg: number;
}

/** A point projected into the picture: fractions of the frame from the left and the top, and its depth in metres. */
export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** Distance along the view axis in metres, positive in front of the camera. */
  readonly depth: number;
}

/** A 2D box in frame fractions: left, top, width and height. */
export interface FrameBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
