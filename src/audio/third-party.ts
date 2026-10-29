/**
 * The third-party notice `audio install` shows before anything is fetched
 * (ADR 0007): the three licenses inside the narration component that are
 * not Apache-2.0 or MIT, as data, so the command and the tests read one
 * list. THIRD-PARTY.md carries the full table (src/licenses/notice-extras.ts);
 * this is the summary the user confirms with --yes.
 */

/** One license inside the component that the user is told about before installing. */
export interface ThirdPartyNotice {
  /** What carries the license, for example "eSpeak NG". */
  readonly name: string;
  /** SPDX identifier, or "Proprietary". */
  readonly license: string;
  /** The package of the component that bundles it. */
  readonly inside: string;
  /** One sentence: why it is listed and what it means on the CPU path. */
  readonly note: string;
}

/** The notices, in the order they are printed. */
export const narrationThirdPartyNotices: readonly ThirdPartyNotice[] = [
  {
    name: 'eSpeak NG',
    license: 'GPL-3.0-or-later',
    inside: 'phonemizer 1.2.1',
    note: 'An Emscripten build of eSpeak NG turns text into phonemes; its corresponding source is unidentified (https://github.com/xenova/phonemizer.js/issues/6).',
  },
  {
    name: 'libvips',
    license: 'LGPL-3.0-or-later',
    inside: '@img/sharp-win32-x64 0.34.5',
    note: 'The prebuilt sharp binary bundles libvips; sharp is a dependency of @huggingface/transformers and is not used for narration.',
  },
  {
    name: 'DirectML.dll',
    license: 'Proprietary (Microsoft)',
    inside: 'onnxruntime-node 1.21.0',
    note: 'Installed with the ONNX runtime but not used on the CPU path; audio synth records whether the process ever mapped it.',
  },
];

/** The notice as one line per entry, for the log before the confirmation. */
export function describeThirdPartyNotices(notices: readonly ThirdPartyNotice[] = narrationThirdPartyNotices): readonly string[] {
  return notices.map((notice) => `${notice.name} (${notice.license}, inside ${notice.inside}): ${notice.note}`);
}
