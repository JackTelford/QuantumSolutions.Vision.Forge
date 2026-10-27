/** @generated from schemas/shot-spec.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Frames per second of every shot and of the delivery.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "FrameRate".
 */
export type FrameRate = 24 | 25 | 30 | 60;
/**
 * Which lane renders a shot: html (HTML/CSS in a browser), three (Three.js WebGL in a browser) or blender.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Lane".
 */
export type Lane = 'html' | 'three' | 'blender';
/**
 * Shot size from extreme close-up (ECU) to extreme long shot (ELS).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "ShotSize".
 */
export type ShotSize = 'ECU' | 'CU' | 'MCU' | 'MS' | 'MLS' | 'FS' | 'LS' | 'ELS';
/**
 * Camera height and tilt relative to the subject; dutch is a rolled horizon (see dutchDegrees).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "CameraAngle".
 */
export type CameraAngle = 'eye' | 'low' | 'high' | 'overhead' | 'ground' | 'dutch';
/**
 * Lens focal length in millimetres on a 36 mm sensor (ADR 0008).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "FocalLength".
 */
export type FocalLength = 14 | 18 | 24 | 28 | 35 | 50 | 65 | 85 | 100 | 135 | 200;
/**
 * Shutter angle in degrees; 180 is the cinematic default, 360 doubles the motion blur, 90 halves it.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "ShutterAngle".
 */
export type ShutterAngle = 90 | 180 | 360;
/**
 * Camera move preset baked by src/shared/camera/ into per-frame position, rotation, focal length and focus (ADR 0008).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "CameraMove".
 */
export type CameraMove =
  | 'static-hold'
  | 'breathe'
  | 'push-in'
  | 'pull-out'
  | 'truck-left'
  | 'truck-right'
  | 'pedestal-up'
  | 'pedestal-down'
  | 'pan-left'
  | 'pan-right'
  | 'tilt-up'
  | 'tilt-down'
  | 'arc-left'
  | 'arc-right'
  | 'turntable'
  | 'crane-reveal'
  | 'rack-focus'
  | 'zoom-in'
  | 'zoom-out'
  | 'crash-zoom'
  | 'dolly-zoom'
  | 'whip-pan'
  | 'handheld'
  | 'parallax-drift'
  | 'light-sweep'
  | 'top-down-reveal';
/**
 * Easing curve of a move or an animation, evaluated by src/shared/easing/ as a pure function of progress.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "EasingToken".
 */
export type EasingToken =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'standard'
  | 'standard-decelerate'
  | 'standard-accelerate'
  | 'emphasized'
  | 'emphasized-decelerate'
  | 'emphasized-accelerate'
  | 'sine-in-out'
  | 'spring';
/**
 * Lighting setup from the lighting cookbook; every lane maps it to its own lights and calibrated intensities.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "LightingPreset".
 */
export type LightingPreset =
  | 'product-studio'
  | 'three-point-soft'
  | 'rembrandt'
  | 'butterfly'
  | 'split'
  | 'rim-only'
  | 'contre-jour'
  | 'window'
  | 'soft-cross'
  | 'high-key'
  | 'low-key'
  | 'golden-hour'
  | 'overcast-soft'
  | 'neon-night'
  | 'practical-glow'
  | 'neon-rim';
/**
 * Where the subject sits in the frame: the centre, a rule-of-thirds line or a golden-ratio line.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "CompositionAnchor".
 */
export type CompositionAnchor =
  'center' | 'thirds-left' | 'thirds-right' | 'thirds-top' | 'thirds-bottom' | 'golden-left' | 'golden-right';
/**
 * Which side of the frame text occupies relative to the subject; none means the shot carries no text.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TextSide".
 */
export type TextSide = 'left' | 'right' | 'center' | 'none';
/**
 * The typographic role of a text element; the look bible's type scale sets its size and tracking.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TextRole".
 */
export type TextRole =
  'title' | 'subtitle' | 'body' | 'caption' | 'label' | 'lower-third-name' | 'lower-third-title' | 'counter';
/**
 * How a text element enters, as a pure function of the frame number.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TextAnimation".
 */
export type TextAnimation =
  'none' | 'fade-rise' | 'blur-in' | 'mask-wipe' | 'tracking-in' | 'stagger-words' | 'counter';
/**
 * Procedural stand-in geometry for the subject when no asset is supplied; none means no stand-in.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Primitive".
 */
export type Primitive =
  'none' | 'bottle' | 'can' | 'box' | 'slab' | 'card' | 'pill' | 'jar' | 'sphere' | 'cylinder' | 'torus';
/**
 * Whether the GPU (hardware) or a CPU rasterizer such as SwiftShader (software) produced the pixels.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Renderer".
 */
export type Renderer = 'hardware' | 'software';
/**
 * The join between two shots or clips, mapped to ffmpeg xfade transitions (cut has no overlap).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TransitionType".
 */
export type TransitionType =
  | 'cut'
  | 'dissolve'
  | 'fade-black'
  | 'fade-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right';

/**
 * Every shot of a piece, fully specified: lane, length, camera (ADR 0008), lighting, composition, text, subject and atmosphere, plus the transitions between shots. The lanes render from it; the shot hash is computed over each shot (ADR 0006).
 */
export interface ShotSpec {
  /**
   * Document kind; always "shot-spec".
   */
  kind: 'shot-spec';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Slug that names the shot spec, 2 to 63 lowercase letters, digits and hyphens, for example "obsidian-bottle-shots".
   */
  id: string;
  /**
   * Id of the brief the shots serve, for example "obsidian-bottle".
   */
  briefId: string;
  /**
   * Id of the treatment the shots come from, for example "obsidian-bottle-t1".
   */
  treatmentId: string;
  /**
   * Id of the look bible every shot uses, for example "obsidian".
   */
  lookId: string;
  fps: FrameRate;
  /**
   * Frame width in pixels of every shot, even, for example 1920.
   */
  width: number;
  /**
   * Frame height in pixels of every shot, even, for example 1080.
   */
  height: number;
  /**
   * The shots in screen order; at least one for a piece that renders.
   */
  shots: Shot[];
  /**
   * Transitions between consecutive shots; a pair of shots without an entry is joined by a cut. Each transition other than a cut shortens the piece by its frame count; a cut's frames are ignored.
   */
  transitions: Transition[];
  /**
   * When the shot spec was written: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  createdAt: string;
}
/**
 * One shot: everything a lane needs to render every frame of it as a pure function of the frame number.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Shot".
 */
export interface Shot {
  /**
   * Identifier of the shot, unique within the spec and used by the treatment, the job and the render manifest, for example "s01".
   */
  id: string;
  /**
   * Short name of the shot, for example "Shoulder sweep".
   */
  title: string;
  lane: Lane;
  /**
   * Length of the shot in frames at the spec's fps, for example 120 for four seconds at 30 fps.
   */
  durationFrames: number;
  size: ShotSize;
  angle: CameraAngle;
  /**
   * Horizon roll in degrees, -15 to 15, positive clockwise; 0 for a level horizon, for example 4 for a dutch angle.
   */
  dutchDegrees: number;
  lens: Lens;
  move: Move;
  lighting: Lighting;
  /**
   * Exposure offset in EV stops relative to the look bible's exposureEv, -2 to 2, for example -0.5.
   */
  exposureOffsetEv: number;
  composition: Composition;
  /**
   * Text elements overlaid on the shot, in reading order; empty when the shot carries no text.
   */
  text: TextElement[];
  subject: ShotSubject;
  atmosphere: Atmosphere;
  /**
   * Id of the narration line that starts with this shot, for example "n1"; null when none.
   */
  narrationEvent: string | null;
  /**
   * Seed of every seeded random choice in the shot (handheld jitter, motes), for example 7; the same seed reproduces the same frames.
   */
  seed: number;
  /**
   * How the still gate rendered the shot (ADR 0004): engine, backend and renderer; render refuses to switch. Null until the still gate sets it.
   */
  renderProfile: {
    /**
     * Rendering engine, for example "chromium" for the browser lanes, "cycles" or "eevee" for Blender.
     */
    engine: string;
    /**
     * Graphics backend the engine used: the ANGLE backend such as "d3d11" or "swiftshader-webgl" for browsers, the compute device such as "CUDA" or "CPU" for Blender.
     */
    backend: string;
    renderer: Renderer;
  } | null;
}
/**
 * The physical lens of the shot on a 36 mm sensor (ADR 0008); every lane maps it to the same framing.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Lens".
 */
export interface Lens {
  focalMm: FocalLength;
  /**
   * Aperture as an f-number, 1.4 to 22, for example 2.8; smaller is shallower focus.
   */
  fStop: number;
  /**
   * Distance from the camera to the focus plane in metres, greater than 0, for example 1.2.
   */
  focusDistanceM: number;
  shutterAngleDeg: ShutterAngle;
}
/**
 * The camera move of the shot, baked per frame by src/shared/camera/.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Move".
 */
export interface Move {
  preset: CameraMove;
  /**
   * Strength of the move from 0 (none) to 1 (the preset's full travel), for example 0.6.
   */
  amplitude: number;
  easing: EasingToken;
  /**
   * Frame of the shot at which the move starts, counted from 0 and below durationFrames, for example 0.
   */
  startFrame: number;
  /**
   * Frame of the shot at which the move has finished (exclusive), above startFrame and at most durationFrames, for example 120; null means it finishes with the shot.
   */
  endFrame: number | null;
}
/**
 * The lighting of the shot: a cookbook preset with per-shot intensity and colour temperature adjustments.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Lighting".
 */
export interface Lighting {
  preset: LightingPreset;
  /**
   * Key light intensity as a multiplier of the preset's own, 0 or more; 1 keeps the preset, for example 1.2.
   */
  keyIntensity: number;
  /**
   * Key-to-fill ratio, greater than 0; 4 means the key is four times the fill, for example 4.
   */
  fillRatio: number;
  /**
   * Rim light intensity as a multiplier of the preset's own, 0 or more; 0 removes the rim, for example 0.8.
   */
  rimIntensity: number;
  /**
   * Colour temperature of the key light in kelvin, 1000 to 20000, for example 5600 for daylight.
   */
  kelvin: number;
}
/**
 * Where the subject and the text sit in the frame; the composition solver places the camera from it.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Composition".
 */
export interface Composition {
  anchor: CompositionAnchor;
  /**
   * Space above the subject as a percentage of the frame height, 0 to 30, for example 10.
   */
  headroomPct: number;
  /**
   * Space in front of the subject in its facing or moving direction as a percentage of the frame width, 0 to 40, for example 15.
   */
  leadRoomPct: number;
  textSide: TextSide;
}
/**
 * One piece of text overlaid on the shot, animated as a pure function of the frame number.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TextElement".
 */
export interface TextElement {
  /**
   * Identifier of the text element, unique within the shot, for example "t1".
   */
  id: string;
  role: TextRole;
  /**
   * The text shown, verbatim, for example "Now in 500 ml".
   */
  content: string;
  box: TextBox;
  animation: TextAnimation;
  /**
   * Delay between successive words or characters in milliseconds for staggered animations, 0 or more, for example 40.
   */
  staggerMs: number;
  /**
   * Frame of the shot at which the element starts entering, counted from 0 and below durationFrames, for example 12.
   */
  inFrame: number;
  /**
   * Frame of the shot at which the element is gone (exclusive), above inFrame and at most durationFrames, for example 110; null means it stays until the shot ends.
   */
  outFrame: number | null;
}
/**
 * The box a text element occupies, as fractions of the frame from its top-left corner; it must lie inside the title-safe area (the central 90 percent).
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "TextBox".
 */
export interface TextBox {
  /**
   * Left edge as a fraction of the frame width, 0 to 1, for example 0.1.
   */
  x: number;
  /**
   * Top edge as a fraction of the frame height, 0 to 1, for example 0.7.
   */
  y: number;
  /**
   * Width as a fraction of the frame width, 0 to 1, for example 0.4.
   */
  w: number;
  /**
   * Height as a fraction of the frame height, 0 to 1, for example 0.12.
   */
  h: number;
}
/**
 * What the shot shows: a ledger asset or a procedural primitive, with its size.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "ShotSubject".
 */
export interface ShotSubject {
  /**
   * Id of the ledger asset that is the subject, present in assets.json under the data directory, for example "model:bottle"; null when the primitive stands in.
   */
  assetId: string | null;
  primitive: Primitive;
  boundsM: BoundsM;
}
/**
 * The subject's bounding box in metres; the composition solver frames it.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "BoundsM".
 */
export interface BoundsM {
  /**
   * Width in metres, greater than 0, for example 0.08.
   */
  w: number;
  /**
   * Height in metres, greater than 0, for example 0.25.
   */
  h: number;
  /**
   * Depth in metres, greater than 0, for example 0.08.
   */
  d: number;
}
/**
 * Depth cues in the air of the shot.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Atmosphere".
 */
export interface Atmosphere {
  /**
   * Haze density from 0 (clear) to 1 (thick), for example 0.15.
   */
  haze: number;
  /**
   * Number of floating dust motes, 0 or more, placed from the shot's seed, for example 200.
   */
  motes: number;
}
/**
 * A transition that starts at the end of one shot and overlaps the start of the next.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "Transition".
 */
export interface Transition {
  /**
   * Id of the shot the transition follows; it must not be the last shot.
   */
  afterShotId: string;
  type: TransitionType;
  /**
   * Overlap length in frames, for example 15 for half a second at 30 fps; no longer than either neighbouring shot; ignored for a cut.
   */
  frames: number;
}
/**
 * How a lane rendered a shot: the engine, its backend and whether a hardware or software renderer produced the pixels. The same shape as the render manifest's renderProfile.
 *
 * This interface was referenced by `ShotSpec`'s JSON-Schema
 * via the `definition` "RenderProfile".
 */
export interface RenderProfile {
  /**
   * Rendering engine, for example "chromium" for the browser lanes, "cycles" or "eevee" for Blender.
   */
  engine: string;
  /**
   * Graphics backend the engine used: the ANGLE backend such as "d3d11" or "swiftshader-webgl" for browsers, the compute device such as "CUDA" or "CPU" for Blender.
   */
  backend: string;
  renderer: Renderer;
}

/** Every Lane value the schema allows, in schema order. */
export const LaneValues = ['html', 'three', 'blender'] as const;

/** Every FrameRate value the schema allows, in schema order. */
export const FrameRateValues = [24, 25, 30, 60] as const;

/** Every ShotSize value the schema allows, in schema order. */
export const ShotSizeValues = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'LS', 'ELS'] as const;

/** Every CameraAngle value the schema allows, in schema order. */
export const CameraAngleValues = ['eye', 'low', 'high', 'overhead', 'ground', 'dutch'] as const;

/** Every CameraMove value the schema allows, in schema order. */
export const CameraMoveValues = ['static-hold', 'breathe', 'push-in', 'pull-out', 'truck-left', 'truck-right', 'pedestal-up', 'pedestal-down', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'arc-left', 'arc-right', 'turntable', 'crane-reveal', 'rack-focus', 'zoom-in', 'zoom-out', 'crash-zoom', 'dolly-zoom', 'whip-pan', 'handheld', 'parallax-drift', 'light-sweep', 'top-down-reveal'] as const;

/** Every EasingToken value the schema allows, in schema order. */
export const EasingTokenValues = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'standard', 'standard-decelerate', 'standard-accelerate', 'emphasized', 'emphasized-decelerate', 'emphasized-accelerate', 'sine-in-out', 'spring'] as const;

/** Every FocalLength value the schema allows, in schema order. */
export const FocalLengthValues = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135, 200] as const;

/** Every ShutterAngle value the schema allows, in schema order. */
export const ShutterAngleValues = [90, 180, 360] as const;

/** Every LightingPreset value the schema allows, in schema order. */
export const LightingPresetValues = ['product-studio', 'three-point-soft', 'rembrandt', 'butterfly', 'split', 'rim-only', 'contre-jour', 'window', 'soft-cross', 'high-key', 'low-key', 'golden-hour', 'overcast-soft', 'neon-night', 'practical-glow', 'neon-rim'] as const;

/** Every CompositionAnchor value the schema allows, in schema order. */
export const CompositionAnchorValues = ['center', 'thirds-left', 'thirds-right', 'thirds-top', 'thirds-bottom', 'golden-left', 'golden-right'] as const;

/** Every TextSide value the schema allows, in schema order. */
export const TextSideValues = ['left', 'right', 'center', 'none'] as const;

/** Every TextRole value the schema allows, in schema order. */
export const TextRoleValues = ['title', 'subtitle', 'body', 'caption', 'label', 'lower-third-name', 'lower-third-title', 'counter'] as const;

/** Every TextAnimation value the schema allows, in schema order. */
export const TextAnimationValues = ['none', 'fade-rise', 'blur-in', 'mask-wipe', 'tracking-in', 'stagger-words', 'counter'] as const;

/** Every Primitive value the schema allows, in schema order. */
export const PrimitiveValues = ['none', 'bottle', 'can', 'box', 'slab', 'card', 'pill', 'jar', 'sphere', 'cylinder', 'torus'] as const;

/** Every TransitionType value the schema allows, in schema order. */
export const TransitionTypeValues = ['cut', 'dissolve', 'fade-black', 'fade-white', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right'] as const;

/** Every Renderer value the schema allows, in schema order. */
export const RendererValues = ['hardware', 'software'] as const;
