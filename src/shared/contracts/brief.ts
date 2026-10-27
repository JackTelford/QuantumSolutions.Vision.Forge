/** @generated from schemas/brief.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * What the piece is for; it selects the default lane, tempo and templates.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "UseCase".
 */
export type UseCase =
  'product-shot' | 'explainer' | 'title-sequence' | 'lower-third' | 'kinetic-type' | 'chart' | 'still' | 'custom';
/**
 * Frame aspect ratio as width:height.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "Aspect".
 */
export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';
/**
 * Frames per second of every shot and of the delivery.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "FrameRate".
 */
export type FrameRate = 24 | 25 | 30 | 60;
/**
 * Cutting rhythm: calm (long shots), dynamic (medium), chaotic (very short) or single-shot (no cuts).
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "Tempo".
 */
export type Tempo = 'calm' | 'dynamic' | 'chaotic' | 'single-shot';
/**
 * What the piece shows: a product, an abstract form, a diagram, text, an environment or a mix.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "SubjectKind".
 */
export type SubjectKind = 'product' | 'abstract' | 'diagram' | 'text' | 'environment' | 'mixed';
/**
 * Procedural stand-in geometry for the subject when no asset is supplied; none means no stand-in.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "Primitive".
 */
export type Primitive =
  'none' | 'bottle' | 'can' | 'box' | 'slab' | 'card' | 'pill' | 'jar' | 'sphere' | 'cylinder' | 'torus';
/**
 * Narration voice of the optional narration component (ADR 0007); the prefix is accent and gender.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "Voice".
 */
export type Voice = 'af_heart' | 'af_bella' | 'af_nicole' | 'af_sarah' | 'bf_emma' | 'bm_george' | 'am_michael';
/**
 * Where music comes from: none, or a file the user supplies and licenses.
 *
 * This interface was referenced by `Brief`'s JSON-Schema
 * via the `definition` "MusicPolicy".
 */
export type MusicPolicy = 'none' | 'user-supplied';

/**
 * The user's request as the skill understood it: the prompt verbatim, the use case, the frame, the tempo, the subject, narration and music choices, and the limits the user acknowledged. The first document of a job; the treatment is derived from it.
 */
export interface Brief {
  /**
   * Document kind; always "brief".
   */
  kind: 'brief';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Slug that names the brief, 2 to 63 lowercase letters, digits and hyphens, for example "obsidian-bottle". Later documents refer to it as briefId.
   */
  id: string;
  /**
   * Working title of the piece, for example "Obsidian bottle reveal".
   */
  title: string;
  /**
   * The user's words verbatim, unedited, for example "a 10 second product reveal of a black glass bottle".
   */
  prompt: string;
  useCase: UseCase;
  /**
   * What the piece must achieve in one sentence, for example "make the bottle feel premium".
   */
  goal: string;
  /**
   * Who watches it, for example "shoppers on a product page".
   */
  audience: string;
  /**
   * Target length in seconds, greater than 0, for example 10.
   */
  durationSeconds: number;
  aspect: Aspect;
  fps: FrameRate;
  /**
   * Frame width in pixels, even, matching aspect, for example 1920.
   */
  width: number;
  /**
   * Frame height in pixels, even, matching aspect, for example 1080.
   */
  height: number;
  tempo: Tempo;
  /**
   * The feeling the piece should leave, for example "quiet confidence".
   */
  emotion: string;
  /**
   * Genre reference when the user gave one, for example "luxury advertising"; null when none.
   */
  genre: string | null;
  /**
   * Period reference when the user gave one, for example "1970s"; null when none.
   */
  era: string | null;
  /**
   * Colour words from the prompt, in the order they appeared; empty when none.
   *
   * Items: One colour hint, for example "deep black" or "#0b0b0f".
   */
  paletteHints: string[];
  /**
   * Text the piece must show verbatim, in order; empty when none.
   *
   * Items: One required line of text, for example "Now in 500 ml".
   */
  mustHaveText: string[];
  /**
   * What the piece shows.
   */
  subject: {
    /**
     * The subject in plain words, for example "a matte black glass bottle with a silver cap".
     */
    description: string;
    kind: SubjectKind;
    primitive: Primitive;
    /**
     * Ids of ledger assets the subject uses (models, HDRIs), each present in assets.json under the data directory; empty when none.
     *
     * Items: One asset id as the ledger records it, for example "hdri:studio_small_09".
     */
    assetIds: string[];
  };
  /**
   * Whether the piece is narrated and by which voice.
   */
  narration: {
    /**
     * True when narration is produced (the narration component must be installed, ADR 0007).
     */
    enabled: boolean;
    voice: Voice;
    /**
     * The narration text when the user supplied it, for example "Meet the new bottle."; null when the treatment writes it or narration is off.
     */
    script: string | null;
  };
  /**
   * Where music comes from.
   */
  music: {
    policy: MusicPolicy;
    /**
     * Absolute path of the user's music file (WAV, FLAC, MP3 or AAC) when policy is user-supplied, for example C:/music/bed.wav; null otherwise.
     */
    path: string | null;
  };
  /**
   * Limits the skill told the user about and the user accepted, in order; empty when none applied.
   *
   * Items: One acknowledged limit, for example "no photoreal humans".
   */
  limitsAcknowledged: string[];
  /**
   * When the brief was written: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  createdAt: string;
}

/** Every UseCase value the schema allows, in schema order. */
export const UseCaseValues = ['product-shot', 'explainer', 'title-sequence', 'lower-third', 'kinetic-type', 'chart', 'still', 'custom'] as const;

/** Every Aspect value the schema allows, in schema order. */
export const AspectValues = ['16:9', '9:16', '1:1', '4:5', '21:9'] as const;

/** Every FrameRate value the schema allows, in schema order. */
export const FrameRateValues = [24, 25, 30, 60] as const;

/** Every Tempo value the schema allows, in schema order. */
export const TempoValues = ['calm', 'dynamic', 'chaotic', 'single-shot'] as const;

/** Every SubjectKind value the schema allows, in schema order. */
export const SubjectKindValues = ['product', 'abstract', 'diagram', 'text', 'environment', 'mixed'] as const;

/** Every Primitive value the schema allows, in schema order. */
export const PrimitiveValues = ['none', 'bottle', 'can', 'box', 'slab', 'card', 'pill', 'jar', 'sphere', 'cylinder', 'torus'] as const;

/** Every Voice value the schema allows, in schema order. */
export const VoiceValues = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'bf_emma', 'bm_george', 'am_michael'] as const;

/** Every MusicPolicy value the schema allows, in schema order. */
export const MusicPolicyValues = ['none', 'user-supplied'] as const;
