/** @generated from schemas/job.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Where a job stands in the pipeline: planned, stills (the still gate), rendering, assembling, qa, delivered or failed.
 *
 * This interface was referenced by `Job`'s JSON-Schema
 * via the `definition` "JobStatus".
 */
export type JobStatus = 'planned' | 'stills' | 'rendering' | 'assembling' | 'qa' | 'delivered' | 'failed';
/**
 * Where one shot of a job stands: pending, still-rendered (awaiting review), still-approved, rendered or failed.
 *
 * This interface was referenced by `Job`'s JSON-Schema
 * via the `definition` "ShotStatus".
 */
export type ShotStatus = 'pending' | 'still-rendered' | 'still-approved' | 'rendered' | 'failed';

/**
 * The state of one production run: where its documents live, how far the pipeline has come and where each shot stands with its cache key, manifest, still and review rounds. Written as job.json under the output directory and updated by every stage.
 */
export interface Job {
  /**
   * Document kind; always "job".
   */
  kind: 'job';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Job identifier, 8 lowercase letters and digits, for example "k7f2q9x1"; it names the job folder.
   */
  id: string;
  /**
   * When the job was created: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  createdAt: string;
  /**
   * Absolute path of the brief document, for example C:/vf/out/k7f2q9x1/brief.json.
   */
  briefPath: string;
  /**
   * Absolute path of the treatment document, for example C:/vf/out/k7f2q9x1/treatment.json.
   */
  treatmentPath: string;
  /**
   * Absolute path of the shot spec document, for example C:/vf/out/k7f2q9x1/shot-spec.json.
   */
  shotSpecPath: string;
  /**
   * Absolute path of the look bible document, for example C:/vf/out/k7f2q9x1/look-bible.json.
   */
  lookPath: string;
  /**
   * Absolute path of the output directory the deliverables are written to, for example C:/vf/out/k7f2q9x1.
   */
  outDir: string;
  /**
   * Absolute path of the data directory the job used (caches, tools manifest, asset ledger), for example C:/Users/me/AppData/Local/VisionForge.
   */
  dataDir: string;
  status: JobStatus;
  /**
   * One entry per shot of the shot spec, in screen order.
   */
  shots: JobShot[];
  /**
   * Absolute path of the delivered file once status is delivered, for example C:/vf/out/k7f2q9x1/film.mp4; null before.
   */
  deliverablePath: string | null;
}
/**
 * Where one shot of the job stands.
 *
 * This interface was referenced by `Job`'s JSON-Schema
 * via the `definition` "JobShot".
 */
export interface JobShot {
  /**
   * The shot id as the shot spec names it, unique within the job, for example "s01".
   */
  id: string;
  /**
   * Shot hash as 64 lowercase hex characters (ADR 0006, decision 8), the same value the render manifest records; names the cache folder.
   */
  key: string;
  status: ShotStatus;
  /**
   * Absolute path of the shot's render manifest once a render started, for example C:/vf/cache/<key>/manifest.json; null before.
   */
  manifestPath: string | null;
  /**
   * Absolute path of the latest still rendered for the gate, for example C:/vf/out/k7f2q9x1/stills/s01-r1.png; null before the first still.
   */
  stillPath: string | null;
  /**
   * Number of still review rounds completed, 0 or more, for example 1; the retry cap is 3.
   */
  rounds: number;
  /**
   * The key of the shot's text plate (ADR 0008, decision 4): the content hash of the shot key, the plate name and the html lane's fingerprint, as 64 lowercase hex characters; names the text plate's cache folder. Absent for an html shot and for a shot without text elements.
   */
  textKey?: string;
  /**
   * Absolute path of the text plate's render manifest once its render started, for example C:/vf/cache/<textKey>/manifest.json; absent before, and absent for a shot without a text plate.
   */
  textManifestPath?: string;
}

/** Every JobStatus value the schema allows, in schema order. */
export const JobStatusValues = ['planned', 'stills', 'rendering', 'assembling', 'qa', 'delivered', 'failed'] as const;

/** Every ShotStatus value the schema allows, in schema order. */
export const ShotStatusValues = ['pending', 'still-rendered', 'still-approved', 'rendered', 'failed'] as const;
