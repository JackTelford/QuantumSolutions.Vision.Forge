/**
 * Assets and narration: assets, audio_install, audio_status, audio_voices
 * and audio_synth. audio_synth takes the script inline as well as by path
 * (ADR 0009 decision 4).
 */
import { UsageError } from '../../errors/vision-forge-error.ts';
import type { ToolCallContext } from '../types.ts';
import { OptionKinds, booleanProperty, downloadAnnotations, inputSchema, listProperty, localWriteAnnotations, numberProperty, pathProperty, readOnlyAnnotations, stringProperty } from './definitions.ts';
import type { ToolSpec } from './definitions.ts';
import { writeInlineText } from './inline-documents.ts';
import { readString } from './inputs.ts';

/** assets: the pinned CC0 catalogue; list, fetch, verify, credits. */
export const assetsSpec: ToolSpec = {
  name: 'assets',
  description: 'The pinned catalogue of CC0 Poly Haven HDRIs (hdri:<name>-1k and -2k, ten entries). With no option, or list, it shows what is installed; fetch downloads the named ids into <data dir>/assets/hdri/ through the allowlisted downloader, verifies size and MD5 and records the ledger; all fetches every entry; verify re-hashes the installed files (code asset-integrity names a changed file, set aside for fetch to download again); credits writes CREDITS.md with every downloaded asset and the four bundled OFL fonts. The fonts (Inter, Space Grotesk, Playfair Display, JetBrains Mono) ship with the skill. Run it before plan when the brief or shot spec names asset ids. Only fetch and all reach the network.',
  command: ['assets'],
  options: [
    { key: 'list', option: 'list', kind: OptionKinds.flag },
    { key: 'fetch', option: 'fetch', kind: OptionKinds.list },
    { key: 'all', option: 'all', kind: OptionKinds.flag },
    { key: 'verify', option: 'verify', kind: OptionKinds.flag },
    { key: 'credits', option: 'credits', kind: OptionKinds.flag },
    { key: 'creditsPath', option: 'credits-path', kind: OptionKinds.path },
  ],
  inputSchema: inputSchema({
    list: booleanProperty('List the catalogue with what is installed (the default when nothing else is asked).'),
    fetch: listProperty('Asset ids to download, for example ["hdri:studio_small_09-1k"].'),
    all: booleanProperty('Download every entry of the catalogue.'),
    verify: booleanProperty('Re-hash the installed files against the ledger.'),
    credits: booleanProperty('Write CREDITS.md under the output directory.'),
    creditsPath: pathProperty('Where to write the credits file instead of <out>/CREDITS.md; naming it is enough to ask for the file.'),
  }),
  annotations: downloadAnnotations,
  exclusive: false,
};

/** audio_install: the optional narration component, with its notices first. */
export const audioInstallSpec: ToolSpec = {
  name: 'audio_install',
  description: 'Installs the optional narration component (ADR 0007) into <data dir>/narration/. Without yes it only prints what it would install (about 150 MB of packages compressed and 92 MB of weights) and the third-party notices (eSpeak NG under GPL-3.0-or-later, libvips under LGPL-3.0-or-later, a DirectML.dll present but unused) and returns data.confirmed false: show that to the user and call again with yes true only on their yes. The install is resumable; evidence[0] is provenance.json; data.weights[].verified says downloaded, rehashed or ledger. Codes: npm-missing, npm-install-failed, weights-download-failed. Takes minutes: pass background true.',
  command: ['audio', 'install'],
  options: [
    { key: 'yes', option: 'yes', kind: OptionKinds.flag },
    { key: 'verify', option: 'verify', kind: OptionKinds.flag },
  ],
  inputSchema: inputSchema({
    yes: booleanProperty('The user agreed to the notices: install. Without it, nothing is downloaded.'),
    verify: booleanProperty('Re-hash the installed weights against the ledger.'),
  }),
  annotations: downloadAnnotations,
  exclusive: true,
};

/** audio_status: the narration component's state, without npm or the network. */
export const audioStatusSpec: ToolSpec = {
  name: 'audio_status',
  description: 'Reports the narration component: installed, packagesPresent, weightsPresent[], missing[], the ledger records and the provenance, without touching npm or the network.',
  command: ['audio', 'status'],
  options: [],
  inputSchema: inputSchema({}),
  annotations: readOnlyAnnotations,
  exclusive: false,
};

/** audio_voices: the offered English voices. */
export const audioVoicesSpec: ToolSpec = {
  name: 'audio_voices',
  description: 'Lists the offered English narration voices with their grades; af_heart is the default. Narration is English only: always offer the user\'s own recording as the alternative.',
  command: ['audio', 'voices'],
  options: [],
  inputSchema: inputSchema({}),
  annotations: readOnlyAnnotations,
  exclusive: false,
};

/** audio_synth: narration from text, a script file or an inline script. */
export const audioSynthSpec: ToolSpec = {
  name: 'audio_synth',
  description: 'Synthesises narration: normalizes the text (numbers, units, currency, abbreviations), reads one sentence at a time and writes narration.wav (24 kHz mono, -16 LUFS, -1.5 dBTP), captions.srt and narration.json (artifacts the wav and srt, evidence[0] the json) whose sentences[] carry startFrame and endFrame at the fps asked, plus totalFrames and loudness. Pass text for a line, script for a file, or scriptText for the script inline (written under <out>/documents/narration-<hash>.txt). For an explainer run it before the shot durations are locked, since the sentences are the clock, and pass outDir as <job>/narration so assemble finds the files. Codes: narration-not-installed (call audio_install), voice-unknown (the hint lists the voices), narration-load-failed and narration-synthesis-failed (reword the sentence or verify the install).',
  command: ['audio', 'synth'],
  options: [
    { key: 'text', option: 'text', kind: OptionKinds.string },
    { key: 'script', option: 'script', kind: OptionKinds.path },
    { key: 'voice', option: 'voice', kind: OptionKinds.string },
    { key: 'fps', option: 'fps', kind: OptionKinds.number },
    { key: 'gap', option: 'gap', kind: OptionKinds.number },
    { key: 'outDir', option: 'out-dir', kind: OptionKinds.path },
  ],
  inputSchema: inputSchema({
    text: stringProperty('The sentences to read, for a short line.'),
    script: pathProperty('A UTF-8 text file with the script.'),
    scriptText: stringProperty('The script inline, instead of script; it is written under the output directory and read from there.'),
    voice: stringProperty('The voice id; default af_heart (audio_voices lists them).'),
    fps: numberProperty('The frame rate the sentence frames are counted at; default 30.'),
    gap: numberProperty('The pause between sentences in seconds; default 0.35.'),
    outDir: pathProperty('Where the three files go; default <out>/narration. Pass <job>/narration for assemble to pick them up.'),
  }),
  annotations: localWriteAnnotations,
  exclusive: true,
  inlineKeys: ['scriptText'],
  prepare: prepareSynth,
};

async function prepareSynth(input: Readonly<Record<string, unknown>>, context: ToolCallContext): Promise<Record<string, unknown>> {
  const scriptText = readString(input, 'scriptText');
  if (scriptText === undefined) return { ...input };
  if (readString(input, 'script') !== undefined || readString(input, 'text') !== undefined) {
    throw new UsageError('Pass one of "text", "script" or "scriptText".', 'Use "text" for a short line, "script" for a file, or "scriptText" for the script inline.');
  }
  const { scriptText: _inline, ...rest } = input;
  return { ...rest, script: await writeInlineText(context.outDir, 'narration', scriptText) };
}

/** The five specs of this group. */
export const mediaToolSpecs: readonly ToolSpec[] = [assetsSpec, audioInstallSpec, audioStatusSpec, audioVoicesSpec, audioSynthSpec];
