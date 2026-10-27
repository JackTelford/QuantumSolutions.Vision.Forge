/** @generated from schemas/treatment.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Which lane renders a shot: html (HTML/CSS in a browser), three (Three.js WebGL in a browser) or blender.
 *
 * This interface was referenced by `Treatment`'s JSON-Schema
 * via the `definition` "Lane".
 */
export type Lane = 'html' | 'three' | 'blender';

/**
 * The creative plan derived from a brief: the logline, the look it will use, the beats in order with their lanes and the shots each beat owns, what was substituted for what the user asked, and the risks. The shot spec is derived from it.
 */
export interface Treatment {
  /**
   * Document kind; always "treatment".
   */
  kind: 'treatment';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * Slug that names the treatment, 2 to 63 lowercase letters, digits and hyphens, for example "obsidian-bottle-t1".
   */
  id: string;
  /**
   * Id of the brief this treatment answers, for example "obsidian-bottle".
   */
  briefId: string;
  /**
   * The piece in one sentence, for example "A black bottle emerges from darkness as a single light sweeps its shoulder.".
   */
  logline: string;
  /**
   * Id of the look bible every shot uses, for example "obsidian".
   */
  lookId: string;
  /**
   * The beats in screen order; at least one for a piece that renders.
   */
  beats: Beat[];
  /**
   * What the treatment changed from the brief and why, in the order the changes were made; empty when it follows the brief exactly.
   */
  substitutions: Substitution[];
  /**
   * What could make the piece fail, one sentence each; empty when none was identified.
   *
   * Items: One risk, for example "glass caustics may render noisy at the time budget".
   */
  risks: string[];
  /**
   * True when narration audio is produced before shot durations are locked, because sentence lengths set the clock.
   */
  narrationFirst: boolean;
  /**
   * When the treatment was written: an RFC 3339 timestamp in UTC with millisecond precision, for example 2026-10-26T20:00:00.000Z.
   */
  createdAt: string;
}
/**
 * One beat of the piece: a span of screen time with one intent, rendered in one lane and made of one or more shots.
 *
 * This interface was referenced by `Treatment`'s JSON-Schema
 * via the `definition` "Beat".
 */
export interface Beat {
  /**
   * Identifier of the beat, unique within the treatment, for example "b1".
   */
  id: string;
  /**
   * Short name of the beat, for example "Reveal".
   */
  title: string;
  /**
   * What the beat must do for the viewer, for example "establish the bottle as the hero".
   */
  intent: string;
  /**
   * Length of the beat in seconds, greater than 0, for example 4.
   */
  durationSeconds: number;
  lane: Lane;
  /**
   * Ids of the shots that make up the beat, in order; each shot id belongs to exactly one beat.
   *
   * Items: One shot id as the shot spec names it, for example "s01".
   */
  shotIds: string[];
}
/**
 * Something the user asked for that the treatment replaced.
 *
 * This interface was referenced by `Treatment`'s JSON-Schema
 * via the `definition` "Substitution".
 */
export interface Substitution {
  /**
   * What the brief asked for, for example "a hand picking up the bottle".
   */
  requested: string;
  /**
   * What the treatment does instead, for example "the bottle rises on a turntable".
   */
  substitute: string;
  /**
   * Why, in one sentence, for example "photoreal humans are outside the limits the user acknowledged".
   */
  reason: string;
}

/** Every Lane value the schema allows, in schema order. */
export const LaneValues = ['html', 'three', 'blender'] as const;
