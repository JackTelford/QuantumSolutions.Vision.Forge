/**
 * The still loop and the render: still, approve_still and render. still
 * returns the finished still as an image beside the JSON (ADR 0009 decision
 * 5); render runs as a task unless `wait` is true (decision 6).
 */
import type { CliResult } from '../../cli/result.ts';
import type { ToolContent } from '../types.ts';
import { OptionKinds, booleanProperty, inputSchema, localWriteAnnotations, numberProperty, pathProperty, plainInputSchema, stringProperty } from './definitions.ts';
import type { ToolSpec } from './definitions.ts';
import { imageContent, imageMimeType } from './images.ts';

const jobProperty = pathProperty('The job folder, or its job.json, that plan wrote.');

/** The failure code the still gate raises; the still is written before it, so the result's evidence names it. */
export const stillGateCode = 'still-gate';

/**
 * The finished still (data.stillPath) as image content; on a still-gate
 * failure, the still that failed, named in the evidence beside the gate
 * report, since the loop is look at the frame, fix the spec, run again;
 * nothing on any other failure. The composite already includes the text plate.
 */
export async function attachStill(result: CliResult): Promise<readonly ToolContent[]> {
  const data = result.data;
  if (!result.ok) {
    if (result.errors[0]?.code !== stillGateCode) return [];
    const failed = result.evidence.find((path) => imageMimeType(path) !== undefined);
    return failed === undefined ? [] : [await imageContent(failed, 'the still that failed the gate')];
  }
  if (typeof data !== 'object' || data === null) return [];
  const stillPath = (data as { readonly stillPath?: unknown }).stillPath;
  if (typeof stillPath !== 'string') return [];
  return [await imageContent(stillPath, 'the finished still')];
}

/** still: one graded frame of a shot through the still gate, returned as an image. */
export const stillSpec: ToolSpec = {
  name: 'still',
  description: 'Renders one frame of a shot exactly as render will, grades it like the delivery, runs the still gate (composition checks, measured text boxes, WCAG contrast behind every text box, average luma in the look\'s band) and pins the render profile into the job. Writes <job>/stills/<shot>-r<round>.png (artifacts[0], returned here as an image), the raw frame beside it and the gate report (evidence[0]); a three or blender shot with text renders its text plate too and the still is the composite (data.textStillPath). Look at the image before approving. Failure code still-gate lists every failing check and returns the failed still as the image (evidence[1]): look at it, fix the shot spec or the look, never the still, and run again; still-rounds is the three-round cap; lane-unavailable means run doctor; renderer-mismatch means pass renderer "any". A blender shot climbs the attempt ladder (EEVEE OpenGL, EEVEE Vulkan, Cycles OptiX, CUDA, CPU) and may take a minute; pass background true to poll it.',
  command: ['still'],
  options: [
    { key: 'job', option: 'job', kind: OptionKinds.path },
    { key: 'shot', option: 'shot', kind: OptionKinds.string },
    { key: 'frame', option: 'frame', kind: OptionKinds.number },
    { key: 'renderer', option: 'renderer', kind: OptionKinds.string },
    { key: 'scale', option: 'scale', kind: OptionKinds.number },
  ],
  inputSchema: inputSchema({
    job: jobProperty,
    shot: stringProperty('The shot id, as the shot spec names it.'),
    frame: numberProperty('The frame to render, counted from 0 within the shot. Default: the frame where the last text element has finished entering, else the end of the camera move, else the middle.'),
    renderer: stringProperty('Which browser renderer to accept; "any" lifts a renderer-mismatch refusal.', ['hardware', 'software', 'any']),
    scale: numberProperty('Also render the still at this multiple of the frame size (2 gives 4K from 1080p) as <shot>-r<round>-2x.png; a full render, slow for blender.'),
  }, ['job', 'shot']),
  annotations: localWriteAnnotations,
  exclusive: true,
  attach: attachStill,
};

/** approve_still: mark the latest passed still approved; renders nothing. */
export const approveStillSpec: ToolSpec = {
  name: 'approve_still',
  description: 'Marks the shot\'s latest passed still approved, after the user (or the model, looking at the image still returned) accepted it; render refuses shots that are not approved. Renders nothing and takes no render options. Fails when the shot has no passed still yet.',
  command: ['still', '--approve'],
  options: [
    { key: 'job', option: 'job', kind: OptionKinds.path },
    { key: 'shot', option: 'shot', kind: OptionKinds.string },
  ],
  inputSchema: inputSchema({ job: jobProperty, shot: stringProperty('The shot id whose latest passed still is approved.') }, ['job', 'shot']),
  annotations: localWriteAnnotations,
  exclusive: false,
};

/** render: every approved shot (or one) frame by frame into the cache; a task unless wait is true. */
export const renderSpec: ToolSpec = {
  name: 'render',
  description: 'Renders every frame of every approved shot (or the one named) into <data dir>/cache/<key>/frames/ with a render manifest per shot (evidence[]): one browser for the html and three shots, Blender in batches for the blender shots, the text plate of a three or blender shot after its picture. Frames already in a complete manifest are reused; force re-renders. Without `wait` this returns a task id at once: poll task_status for the progress lines (the estimate after the first Blender batch) and the result, and task_cancel stops it (a stopped render resumes on the next call). Confirm with the user before a long render: quote the frame count and the estimate first. data.shots[] carries framePattern, textFramePattern, frames, msPerFrame, reused and, for a blender shot, estimate; data.estimate sums them. Failure codes: shot-not-approved (run still and approve_still first), render-profile-mismatch (the still gate pinned another renderer, or `renderer` disagrees with the pin), plus the still tool\'s browser and Blender codes.',
  command: ['render'],
  options: [
    { key: 'job', option: 'job', kind: OptionKinds.path },
    { key: 'shot', option: 'shot', kind: OptionKinds.string },
    { key: 'renderer', option: 'renderer', kind: OptionKinds.string },
    { key: 'frames', option: 'frames', kind: OptionKinds.string },
    { key: 'force', option: 'force', kind: OptionKinds.flag },
    { key: 'allowUnapproved', option: 'allow-unapproved', kind: OptionKinds.flag },
  ],
  inputSchema: plainInputSchema({
    job: jobProperty,
    shot: stringProperty('Render this shot only; default: every approved shot of the job.'),
    renderer: stringProperty('Which browser renderer to accept; "any" lifts a mismatch refusal.', ['hardware', 'software', 'any']),
    frames: stringProperty('A frame range "a-b" within the shot (counted from 0), for a partial render; default: every frame.'),
    force: booleanProperty('Re-render frames that are already in a complete manifest.'),
    allowUnapproved: booleanProperty('Render shots whose still is not approved; for tests and experiments only, since the still gate is the review.'),
    wait: booleanProperty('When true, run the render inline and return its result when it ends (clients time out near a minute). Default false: start it as a task and return the task id.'),
  }, ['job']),
  annotations: localWriteAnnotations,
  exclusive: true,
  background: { key: 'wait', inverted: true },
};

/** The three specs of this group. */
export const renderToolSpecs: readonly ToolSpec[] = [stillSpec, approveStillSpec, renderSpec];
