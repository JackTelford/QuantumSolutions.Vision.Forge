/**
 * Semantic checks on an assembly plan that a JSON Schema cannot express:
 * unique clip ids, transitions that name real neighbours and fit inside
 * them, a positive total length, even dimensions and an output extension
 * that matches the codec. Pure: no file system, no ffmpeg.
 */
import { extname } from 'node:path';
import type { AssemblyPlan, Codec } from '../../shared/contracts/assembly-plan.ts';

const extensionForCodec: Readonly<Record<Codec, string>> = { h264: '.mp4', hevc: '.mp4', prores: '.mov' };

/** The delivery length in frames: the clips minus every transition overlap. */
export function totalFrames(plan: AssemblyPlan): number {
  const clipFrames = plan.clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  const overlap = plan.transitions.filter((t) => t.type !== 'cut').reduce((sum, t) => sum + t.frames, 0);
  return clipFrames - overlap;
}

/** The frame numbers at which one clip gives way to the next (the start of each transition or cut). */
export function clipStartFrames(plan: AssemblyPlan): readonly number[] {
  const starts: number[] = [];
  let position = 0;
  for (let index = 0; index < plan.clips.length; index += 1) {
    starts.push(position);
    const clip = plan.clips[index];
    if (clip === undefined) break;
    const transition = plan.transitions.find((t) => t.afterClipId === clip.id);
    const overlap = transition === undefined || transition.type === 'cut' ? 0 : transition.frames;
    position += clip.durationFrames - overlap;
  }
  return starts;
}

/** Problems with the plan, as one sentence each; empty when the plan is sound. */
export function checkAssemblyPlan(plan: AssemblyPlan): readonly string[] {
  const problems: string[] = [];
  if (plan.width % 2 !== 0 || plan.height % 2 !== 0) problems.push(`width and height must be even for yuv420p; got ${plan.width}x${plan.height}`);
  if (plan.clips.length === 0) problems.push('the plan has no clips');
  const ids = new Set<string>();
  for (const clip of plan.clips) {
    if (ids.has(clip.id)) problems.push(`clip id "${clip.id}" is used more than once`);
    ids.add(clip.id);
    if (clip.source.kind === 'frames' && !clip.source.path.includes('%')) problems.push(`clip "${clip.id}" has a frames source without a printf pattern such as f%06d.png`);
  }
  const lastId = plan.clips[plan.clips.length - 1]?.id;
  const seenTransitions = new Set<string>();
  for (const transition of plan.transitions) {
    const index = plan.clips.findIndex((clip) => clip.id === transition.afterClipId);
    if (index < 0) {
      problems.push(`transition after "${transition.afterClipId}" names a clip that does not exist`);
      continue;
    }
    if (transition.afterClipId === lastId) problems.push(`transition after "${transition.afterClipId}" follows the last clip`);
    if (seenTransitions.has(transition.afterClipId)) problems.push(`clip "${transition.afterClipId}" has more than one transition after it`);
    seenTransitions.add(transition.afterClipId);
    const before = plan.clips[index];
    const after = plan.clips[index + 1];
    if (transition.type !== 'cut' && before !== undefined && after !== undefined && transition.frames > Math.min(before.durationFrames, after.durationFrames)) {
      problems.push(`transition after "${transition.afterClipId}" is ${transition.frames} frames, longer than one of its clips`);
    }
  }
  if (plan.clips.length > 0 && totalFrames(plan) <= 0) problems.push('the transitions remove every frame; the delivery would be empty');
  const expectedExtension = extensionForCodec[plan.output.codec];
  if (extname(plan.output.path).toLowerCase() !== expectedExtension) problems.push(`output path should end with ${expectedExtension} for codec ${plan.output.codec}`);
  if (plan.output.crf > 51) problems.push(`crf must be 0 to 51; got ${plan.output.crf}`);
  if (plan.audio !== undefined) {
    for (const line of plan.audio.narration) {
      if (line.startFrame >= totalFrames(plan)) problems.push(`narration line ${line.path} starts at frame ${line.startFrame}, after the delivery ends`);
    }
  }
  return problems;
}
