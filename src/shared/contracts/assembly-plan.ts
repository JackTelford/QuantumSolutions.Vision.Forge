/** @generated from schemas/assembly-plan.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * How a clip is stored: frames is a numbered PNG sequence named by a printf pattern, video is one encoded file.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "SourceKind".
 */
export type SourceKind = 'frames' | 'video';
/**
 * The join between two clips, mapped to ffmpeg xfade transitions (cut has no overlap).
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
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
 * One of the bundled OFL font families.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "FontFamily".
 */
export type FontFamily = 'inter' | 'space-grotesk' | 'playfair-display' | 'jetbrains-mono';
/**
 * Delivery codec: h264 (libx264, the default), hevc (libx265) or prores (prores_ks 422 HQ mezzanine).
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Codec".
 */
export type Codec = 'h264' | 'hevc' | 'prores';
/**
 * libx264/libx265 speed preset; medium is the default.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "EncodePreset".
 */
export type EncodePreset =
  'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';

/**
 * What assemble turns into a delivery: the clips in order, the transitions between them, the audio tracks, captions, the finishing grade and the output encode. The render command builds it from a job; tests build it from synthetic clips.
 */
export interface AssemblyPlan {
  /**
   * Document kind; always "assembly-plan".
   */
  kind: 'assembly-plan';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Frames per second of every clip and of the delivery, for example 30.
   */
  fps: number;
  /**
   * Delivery width in pixels, even, for example 1920. Clips of another size are scaled and padded to it.
   */
  width: number;
  /**
   * Delivery height in pixels, even, for example 1080.
   */
  height: number;
  /**
   * The clips in delivery order; at least one.
   */
  clips: Clip[];
  /**
   * Transitions between consecutive clips; a pair of clips without an entry is joined by a cut. Each transition shortens the delivery by its frame count.
   */
  transitions: Transition[];
  audio?: AudioMix;
  captions?: Captions;
  grade?: FinishingGrade;
  output: Output;
}
/**
 * One clip of the delivery.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Clip".
 */
export interface Clip {
  /**
   * Unique clip identifier within the plan, usually the shot id, for example "s03".
   */
  id: string;
  source: ClipSource;
  /**
   * Length of the clip in frames at the plan's fps, for example 90 for three seconds at 30 fps. A video source longer than this is trimmed.
   */
  durationFrames: number;
  /**
   * The clip's text plate (ADR 0008, decision 4): a numbered PNG sequence with alpha, composited over the clip's graded picture before the transitions and the grain. Null or absent when the clip has none.
   */
  overlay?: {
    /**
     * Always "frames": a text plate is a PNG sequence named by a printf pattern.
     */
    kind: 'frames';
    /**
     * Absolute printf pattern of the text plate's frames, for example C:/vf/cache/<textKey>/frames/f%06d.png.
     */
    path: string;
    /**
     * First frame number of the pattern, for example 0.
     */
    startNumber: number;
  } | null;
}
/**
 * Where a clip's pictures come from.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "ClipSource".
 */
export interface ClipSource {
  kind: SourceKind;
  /**
   * Absolute path: for frames, a printf pattern such as C:/vf/job1/s03/frames/f%06d.png; for video, the file itself.
   */
  path: string;
  /**
   * First frame number of a frames pattern, for example 1; ignored for video (use 0).
   */
  startNumber: number;
}
/**
 * A transition that starts at the end of one clip and overlaps the start of the next.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Transition".
 */
export interface Transition {
  /**
   * Id of the clip the transition follows; it must not be the last clip.
   */
  afterClipId: string;
  type: TransitionType;
  /**
   * Overlap length in frames, for example 15 for half a second at 30 fps; no longer than either neighbouring clip.
   */
  frames: number;
}
/**
 * The audio of the delivery: narration lines, optional music, loudness targets. Absent when the delivery is silent.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "AudioMix".
 */
export interface AudioMix {
  /**
   * Narration lines in timeline order; empty when there is none.
   */
  narration: NarrationLine[];
  /**
   * The music track, or null when there is none.
   */
  music: {
    /**
     * Absolute path of the music file (WAV, FLAC, MP3 or AAC); the user is responsible for its license.
     */
    path: string;
    /**
     * True to lower the music while narration plays (ffmpeg sidechaincompress).
     */
    duckUnderNarration: boolean;
    /**
     * Gain applied to the music before mixing, in decibels, for example -12.
     */
    gainDb: number;
  } | null;
  /**
   * Integrated loudness target in LUFS for the two-pass loudnorm, for example -16.
   */
  loudnessLufs: number;
  /**
   * True-peak ceiling in dBTP, for example -1.5.
   */
  truePeakDbtp: number;
}
/**
 * One narration recording placed on the timeline.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "NarrationLine".
 */
export interface NarrationLine {
  /**
   * Absolute path of a WAV file (24 kHz or 48 kHz, mono or stereo).
   */
  path: string;
  /**
   * Frame of the delivery at which the line starts, for example 45.
   */
  startFrame: number;
}
/**
 * Captions for the delivery: an SRT file that is attached as a sidecar and, when burnIn is true, rendered into the picture.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Captions".
 */
export interface Captions {
  /**
   * Absolute path of the SRT file.
   */
  srtPath: string;
  /**
   * True to render the captions into the frames with the subtitles filter.
   */
  burnIn: boolean;
  style?: CaptionStyle;
}
/**
 * How burnt-in captions are set, from the look: its body family from the bundled fonts, its text colour on a scrim of its background colour, a size and a bottom margin in pixels at the delivery's height. Absent captions take ffmpeg's own style, which no look should want.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "CaptionStyle".
 */
export interface CaptionStyle {
  fontFamily: FontFamily;
  /**
   * The caption colour as lowercase #rrggbb, the look's text colour.
   */
  textColor: string;
  /**
   * The box behind each caption line as lowercase #rrggbb, the look's background colour.
   */
  scrimColor: string;
  /**
   * Opacity of the scrim, 0 to 1; 0.6 is the typography system's scrim over picture.
   */
  scrimOpacity: number;
  /**
   * Size of the caption text in pixels at the delivery's height: 36 at 1080p, scaled with the height (the type scale's 24 px floor is a 1080p rule; a 270 px fixture scales to 9).
   */
  fontSizePx: number;
  /**
   * Distance from the bottom edge to the caption's baseline in pixels at the delivery's height, for example 72 at 1080p (inside title safe).
   */
  marginBottomPx: number;
}
/**
 * The finishing applied to every frame before encoding (ADR 0008): a 3D LUT, a vignette and seeded grain. Absent when the clips are delivered as rendered.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "FinishingGrade".
 */
export interface FinishingGrade {
  /**
   * Absolute path of a .cube 3D LUT applied with tetrahedral interpolation in 16-bit RGB, or null for no LUT.
   */
  cubePath: string | null;
  /**
   * Vignette strength from 0 (none) to 1 (strong), for example 0.25.
   */
  vignetteAmount: number;
  /**
   * Vignette falloff from 0 (hard) to 1 (soft), for example 0.6.
   */
  vignetteSoftness: number;
  /**
   * Grain strength from 0 (none) to 1 (heavy), for example 0.15; applied only at assembly, never on stills.
   */
  grainAmount: number;
  /**
   * Seed of the grain noise, for example 7; the same seed reproduces the same grain.
   */
  grainSeed: number;
}
/**
 * The delivery file and its encode settings. Colour is always tagged BT.709, pixel format yuv420p for h264 and hevc.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Output".
 */
export interface Output {
  /**
   * Absolute path of the delivery file, for example C:/vf/out/film.mp4 (.mp4 for h264 and hevc, .mov for prores).
   */
  path: string;
  codec: Codec;
  /**
   * Constant rate factor for h264 and hevc, 0 to 51; 16 is the delivery default. Ignored for prores.
   */
  crf: number;
  preset: EncodePreset;
  /**
   * True to move the MP4 index to the front (-movflags +faststart) so the file streams.
   */
  faststart: boolean;
}
/**
 * A user-supplied music track under the whole delivery.
 *
 * This interface was referenced by `AssemblyPlan`'s JSON-Schema
 * via the `definition` "Music".
 */
export interface Music {
  /**
   * Absolute path of the music file (WAV, FLAC, MP3 or AAC); the user is responsible for its license.
   */
  path: string;
  /**
   * True to lower the music while narration plays (ffmpeg sidechaincompress).
   */
  duckUnderNarration: boolean;
  /**
   * Gain applied to the music before mixing, in decibels, for example -12.
   */
  gainDb: number;
}

/** Every SourceKind value the schema allows, in schema order. */
export const SourceKindValues = ['frames', 'video'] as const;

/** Every TransitionType value the schema allows, in schema order. */
export const TransitionTypeValues = ['cut', 'dissolve', 'fade-black', 'fade-white', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right'] as const;

/** Every Codec value the schema allows, in schema order. */
export const CodecValues = ['h264', 'hevc', 'prores'] as const;

/** Every EncodePreset value the schema allows, in schema order. */
export const EncodePresetValues = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] as const;

/** Every FontFamily value the schema allows, in schema order. */
export const FontFamilyValues = ['inter', 'space-grotesk', 'playfair-display', 'jetbrains-mono'] as const;
