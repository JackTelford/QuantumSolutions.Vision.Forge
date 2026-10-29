/**
 * The English voices of Kokoro-82M as data (ADR 0007). The plugin never
 * depends on kokoro-js, so the table is copied here from the VOICES object
 * bundled in kokoro-js 1.2.1 (node_modules/kokoro-js/dist/kokoro.js, the
 * `overallGrade` of each `a*` and `b*` entry, read from an installed copy on
 * 2026-10-29); the grades come from hexgrad's VOICES.md.
 *
 * Which voices are offered: ADR 0007 says B or better. Only two voices reach
 * B (af_heart A, af_bella A-), so the floor is lowered one step to B-, which
 * admits af_nicole and bf_emma and gives the user four voices, two accents
 * and one of each gender per accent. The rule: the floor is B unless fewer
 * than six voices reach it, in which case it is B-. The default is af_heart,
 * the only A.
 */

/** One voice of the model. */
export interface KokoroVoice {
  /** The id kokoro-js takes, for example "af_heart": accent letter, gender letter, name. */
  readonly name: string;
  readonly gender: 'female' | 'male';
  /** 'american' for a* voices (en-us), 'british' for b* voices (en-gb). */
  readonly accent: 'american' | 'british';
  /** hexgrad's overall grade, A+ to F. */
  readonly grade: string;
}

/** Every English voice of kokoro-js 1.2.1 with its grade, American first, then British, as the package lists them. */
export const kokoroEnglishVoices: readonly KokoroVoice[] = [
  { name: 'af_heart', gender: 'female', accent: 'american', grade: 'A' },
  { name: 'af_alloy', gender: 'female', accent: 'american', grade: 'C' },
  { name: 'af_aoede', gender: 'female', accent: 'american', grade: 'C+' },
  { name: 'af_bella', gender: 'female', accent: 'american', grade: 'A-' },
  { name: 'af_jessica', gender: 'female', accent: 'american', grade: 'D' },
  { name: 'af_kore', gender: 'female', accent: 'american', grade: 'C+' },
  { name: 'af_nicole', gender: 'female', accent: 'american', grade: 'B-' },
  { name: 'af_nova', gender: 'female', accent: 'american', grade: 'C' },
  { name: 'af_river', gender: 'female', accent: 'american', grade: 'D' },
  { name: 'af_sarah', gender: 'female', accent: 'american', grade: 'C+' },
  { name: 'af_sky', gender: 'female', accent: 'american', grade: 'C-' },
  { name: 'am_adam', gender: 'male', accent: 'american', grade: 'F+' },
  { name: 'am_echo', gender: 'male', accent: 'american', grade: 'D' },
  { name: 'am_eric', gender: 'male', accent: 'american', grade: 'D' },
  { name: 'am_fenrir', gender: 'male', accent: 'american', grade: 'C+' },
  { name: 'am_liam', gender: 'male', accent: 'american', grade: 'D' },
  { name: 'am_michael', gender: 'male', accent: 'american', grade: 'C+' },
  { name: 'am_onyx', gender: 'male', accent: 'american', grade: 'D' },
  { name: 'am_puck', gender: 'male', accent: 'american', grade: 'C+' },
  { name: 'am_santa', gender: 'male', accent: 'american', grade: 'D-' },
  { name: 'bf_emma', gender: 'female', accent: 'british', grade: 'B-' },
  { name: 'bf_isabella', gender: 'female', accent: 'british', grade: 'C' },
  { name: 'bm_george', gender: 'male', accent: 'british', grade: 'C' },
  { name: 'bm_lewis', gender: 'male', accent: 'british', grade: 'D+' },
  { name: 'bf_alice', gender: 'female', accent: 'british', grade: 'D' },
  { name: 'bf_lily', gender: 'female', accent: 'british', grade: 'D' },
  { name: 'bm_daniel', gender: 'male', accent: 'british', grade: 'D' },
  { name: 'bm_fable', gender: 'male', accent: 'british', grade: 'C' },
];

/** The grades from best to worst, so a grade's position is its rank. */
const gradeLadder: readonly string[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F', 'F-'];

/** The floor of ADR 0007, and how many voices must reach it before it is lowered one step. */
const preferredFloor = 'B';
const enoughVoices = 6;

/** The position of a grade on the ladder, 0 for A+; an unknown grade ranks below every known one. */
export function gradeRank(grade: string): number {
  const index = gradeLadder.indexOf(grade);
  return index === -1 ? gradeLadder.length : index;
}

/** True when `grade` is `floor` or better. */
export function reachesGrade(grade: string, floor: string): boolean {
  return gradeRank(grade) <= gradeRank(floor);
}

/** The grade floor for a voice table: B when at least six voices reach it, else one step lower (B-). */
export function offeredGradeFloor(voices: readonly KokoroVoice[] = kokoroEnglishVoices): string {
  const atPreferred = voices.filter((voice) => reachesGrade(voice.grade, preferredFloor)).length;
  if (atPreferred >= enoughVoices) return preferredFloor;
  return gradeLadder[gradeRank(preferredFloor) + 1] ?? preferredFloor;
}

/** The floor applied to kokoro-js 1.2.1's grades: B-. */
export const offeredFloor: string = offeredGradeFloor();

/** The voices `audio voices` lists and `audio synth` accepts, best grade first. */
export const offeredVoices: readonly KokoroVoice[] = kokoroEnglishVoices
  .filter((voice) => reachesGrade(voice.grade, offeredFloor))
  .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.name.localeCompare(b.name));

/** The voice used when the brief names none. */
export const defaultVoice = 'af_heart';

/** The offered voice with this name, or undefined when it is unknown or below the floor. */
export function findOfferedVoice(name: string): KokoroVoice | undefined {
  return offeredVoices.find((voice) => voice.name === name);
}
