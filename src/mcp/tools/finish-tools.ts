/**
 * Finishing: assemble, qa and sheet. sheet returns the contact sheet as an
 * image beside the JSON (ADR 0009 decision 5).
 */
import type { CliResult } from '../../cli/result.ts';
import type { ToolContent } from '../types.ts';
import { OptionKinds, booleanProperty, inputSchema, localWriteAnnotations, numberProperty, pathProperty, stringProperty } from './definitions.ts';
import type { ToolSpec } from './definitions.ts';
import { imageContent } from './images.ts';

const jobProperty = pathProperty('The job folder, or its job.json, that plan wrote.');

/** The contact sheet (data.outputPath) as image content; nothing on a failed call. */
export async function attachSheet(result: CliResult): Promise<readonly ToolContent[]> {
  const data = result.data;
  if (!result.ok || typeof data !== 'object' || data === null) return [];
  const outputPath = (data as { readonly outputPath?: unknown }).outputPath;
  if (typeof outputPath !== 'string') return [];
  return [await imageContent(outputPath, 'the contact sheet')];
}

/** assemble: the job's rendered shots into the delivery file. */
export const assembleSpec: ToolSpec = {
  name: 'assemble',
  description: 'Builds the assembly plan from the job and encodes the delivery with ffmpeg: one clip per shot in shot-spec order from the render cache (a shot not rendered under the job\'s key fails with code shot-not-rendered: run render first), each text plate laid over its graded picture, the shot spec\'s transitions, the narration audio_synth wrote under <job>/narration/ with its captions (burnt in with burnIn in the look\'s body face, else the SRT beside the delivery), the user\'s music ducked under narration, the look\'s grade baked to <job>/grade.cube, and <job>/<jobId>.mp4 (.mov for ProRes) at CRF 16. The plan goes to <job>/assembly-plan.json (evidence[0]); artifacts holds the delivery and its .srt; data.verified holds the probed frame count, rate and size. Pass plan instead of job for an assembly plan written by hand (no job is touched; the job options are refused with it). Encoding takes a while: pass background true for a long piece.',
  command: ['assemble'],
  options: [
    { key: 'job', option: 'job', kind: OptionKinds.path },
    { key: 'plan', option: 'plan', kind: OptionKinds.path },
    { key: 'music', option: 'music', kind: OptionKinds.path },
    { key: 'musicGain', option: 'music-gain', kind: OptionKinds.number },
    { key: 'burnIn', option: 'burn-in', kind: OptionKinds.flag },
    { key: 'codec', option: 'codec', kind: OptionKinds.string },
    { key: 'outFile', option: 'out-file', kind: OptionKinds.path },
  ],
  inputSchema: inputSchema({
    job: jobProperty,
    plan: pathProperty('An assembly plan JSON written by hand, instead of job; it names its own audio, captions and output, so the other options are refused with it.'),
    music: pathProperty('A music file the user supplied, mixed under the narration.'),
    musicGain: numberProperty('The music level in dB; default -12.'),
    burnIn: booleanProperty('Burn the captions into the picture instead of writing the SRT beside the delivery.'),
    codec: stringProperty('The delivery codec; default h264. prores writes a .mov.', ['h264', 'hevc', 'prores']),
    outFile: pathProperty('Where to write the delivery; default <job>/<jobId>.mp4.'),
  }),
  annotations: localWriteAnnotations,
  exclusive: true,
};

/** qa: measure the delivery against the plan and write the QA report. */
export const qaSpec: ToolSpec = {
  name: 'qa',
  description: 'Measures the delivery assemble recorded against the plan it wrote: dimensions, fps and duration, exposure drift, black frames, frozen frames outside the planned holds, pops away from the planned cuts, text contrast behind every text element, every shot\'s approved still against its rendered frame (SSIM 0.98 or higher), plus loudness and true peak when there is audio. The report goes to <job>/qa/<jobId>.qa.json (evidence[0]); the job becomes delivered when every check passes and failed otherwise. Fails with code qa-failed naming the failing checks unless noFail is true; job-not-assembled means assemble has not run. Read the report\'s checks[] and repeat each failing check\'s detail to the user; never pass a piece the report failed. Without a job, video measures any file the same way: plan holds it to an assembly plan, textBoxes adds the text-contrast check, still with stillFrame the hero-still-match check, and the report goes to <out>/qa/<video name>.qa.json.',
  command: ['qa'],
  options: [
    { key: 'job', option: 'job', kind: OptionKinds.path },
    { key: 'video', option: 'video', kind: OptionKinds.path },
    { key: 'plan', option: 'plan', kind: OptionKinds.path },
    { key: 'textBoxes', option: 'text-boxes', kind: OptionKinds.path },
    { key: 'still', option: 'still', kind: OptionKinds.path },
    { key: 'stillFrame', option: 'still-frame', kind: OptionKinds.number },
    { key: 'report', option: 'report', kind: OptionKinds.path },
    { key: 'loudnessTarget', option: 'loudness-target', kind: OptionKinds.number },
    { key: 'noFail', option: 'no-fail', kind: OptionKinds.flag },
  ],
  inputSchema: inputSchema({
    job: jobProperty,
    video: pathProperty('A delivery file to measure without a job; not with job.'),
    plan: pathProperty('With video: the assembly plan the dimensions, fps, duration, cuts and fades are held to.'),
    textBoxes: pathProperty('With video: a JSON list of text boxes for the text-contrast check.'),
    still: pathProperty('With video: the approved still (PNG) for the hero-still-match check; needs stillFrame.'),
    stillFrame: numberProperty('With still: the delivery frame (0 or more) the still was rendered from.'),
    report: pathProperty('Where to write the QA report; default <job>/qa/<jobId>.qa.json, or <out>/qa/<video name>.qa.json without a job.'),
    loudnessTarget: numberProperty('The integrated loudness the audio is held to, in LUFS; default -16.'),
    noFail: booleanProperty('Return ok even when a check fails; the report still records every failure.'),
  }),
  annotations: localWriteAnnotations,
  exclusive: true,
};

/** sheet: labelled frames tiled into one PNG, returned as an image. */
export const sheetSpec: ToolSpec = {
  name: 'sheet',
  description: 'Tiles labelled frames into one PNG contact sheet (artifacts[0], returned here as an image). Pass frames (a directory of PNGs, or a JSON list of { path, label }) or video with every (one frame every n, extracted under <out>/sheets/<name>-frames/ and labelled by frame number). A sheet over <job>/stills/ shows the finished stills; one over a shot\'s render cache shows its picture frames before the grade, the plate and the grain; one over the delivery with every 15 shows the finished piece at half-second steps. Look at the sheet before judging a shot and after assemble, before telling the user the piece is done.',
  command: ['sheet'],
  options: [
    { key: 'frames', option: 'frames', kind: OptionKinds.path },
    { key: 'video', option: 'video', kind: OptionKinds.path },
    { key: 'every', option: 'every', kind: OptionKinds.number },
    { key: 'output', option: 'output', kind: OptionKinds.path },
    { key: 'columns', option: 'columns', kind: OptionKinds.number },
    { key: 'thumbWidth', option: 'thumb-width', kind: OptionKinds.number },
  ],
  inputSchema: inputSchema({
    frames: pathProperty('A directory of PNG frames, or a JSON file listing [{ "path", "label" }]; not with video.'),
    video: pathProperty('A video file to sample; not with frames.'),
    every: numberProperty('With video: take one frame every n frames; default 30.'),
    output: pathProperty('Where to write the sheet; default <out>/sheets/<source name>.png.'),
    columns: numberProperty('Thumbnails per row; default 4.'),
    thumbWidth: numberProperty('Thumbnail width in pixels; default 480.'),
  }),
  annotations: localWriteAnnotations,
  exclusive: true,
  attach: attachSheet,
};

/** The three specs of this group. */
export const finishToolSpecs: readonly ToolSpec[] = [assembleSpec, qaSpec, sheetSpec];
