/**
 * The parts of THIRD-PARTY.md that do not come from node_modules: the
 * external programs the user installs, and the optional narration component
 * that `audio install` fetches on request (ADR 0007). Versions and licenses
 * are the pinned ones from docs/research.md; update both together.
 */

/** A row of the "External programs" table. */
export interface ExternalProgram {
  readonly name: string;
  readonly license: string;
  readonly notes: string;
}

/** A row of the "Optional narration component" table. */
export interface OptionalComponent {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly notes: string;
}

/** Everything the notice lists beyond installed packages. */
export interface NoticeExtras {
  readonly externalPrograms: readonly ExternalProgram[];
  readonly narrationComponents: readonly OptionalComponent[];
}

/** Programs this repository drives but never bundles. */
export const externalPrograms: readonly ExternalProgram[] = [
  {
    name: 'ffmpeg',
    license: 'LGPL-2.1-or-later, or GPL-2.0-or-later depending on the build',
    notes: 'External program installed by the user; run as a child process for encoding, probing and frame comparisons.',
  },
  {
    name: 'Blender',
    license: 'GPL-3.0-or-later',
    notes: 'External program installed by the user; runs blender/apply_scene.py through its Python API (bpy).',
  },
  {
    name: 'Microsoft Edge / Google Chrome',
    license: 'Proprietary',
    notes: 'The user\'s installed browser, driven through the Chrome DevTools Protocol (CDP) by playwright-core.',
  },
];

/** The narration component installed by `node scripts/cli.ts audio install` after the user confirms. */
export const narrationComponents: readonly OptionalComponent[] = [
  { name: 'kokoro-js', version: '1.2.1', license: 'Apache-2.0', notes: 'Text-to-speech runtime for the Kokoro model on the CPU.' },
  { name: '@huggingface/transformers', version: '3.8.1', license: 'Apache-2.0', notes: 'Model loader used by kokoro-js.' },
  {
    name: 'onnxruntime-node',
    version: '1.21.0',
    license: 'MIT',
    notes: 'Bundles DirectML.dll under Microsoft\'s proprietary license; present but not used on the CPU path (measured 2026-10-29: not mapped into the process during a synthesis; audio synth records the check in narration.json).',
  },
  {
    name: 'phonemizer',
    version: '1.2.1',
    license: 'Apache-2.0 (as labelled)',
    notes: 'Embeds eSpeak NG (GPL-3.0-or-later); its corresponding source is unidentified: https://github.com/xenova/phonemizer.js/issues/6',
  },
  {
    name: 'sharp and @img/sharp-win32-x64',
    version: '0.34.5',
    license: 'Apache-2.0 AND LGPL-3.0-or-later',
    notes: 'The prebuilt Windows binary bundles libvips (LGPL-3.0-or-later).',
  },
  {
    name: 'onnx-community/Kokoro-82M-v1.0-ONNX (model weights)',
    version: 'v1.0',
    license: 'Apache-2.0',
    notes: 'Downloaded from Hugging Face, pinned to a commit and verified by SHA-256.',
  },
];
