/**
 * The directing prompt and the initialize instructions (ADR 0009, decision
 * 9). The one prompt, `cinematic-studio`, takes the user's brief and expands
 * to the flow of SKILL.md phrased for the tools, followed by the brief; the
 * instructions carry the same flow in short. The words are in prompt-text.ts.
 */
import { ProtocolError } from './jsonrpc.ts';
import { directingFlow, instructionsText } from './prompt-text.ts';
import { JsonRpcErrorCodes } from './types.ts';
import type { PromptDefinition, PromptMessage, ServerPaths } from './types.ts';

/** The name of the directing prompt. */
export const studioPromptName = 'cinematic-studio';

/** The prompts the server offers for the given paths: one, the directing flow with the brief. */
export function studioPrompts(paths: ServerPaths): readonly PromptDefinition[] {
  return [
    {
      name: studioPromptName,
      description: 'Directs a production from a brief: the questionnaire, the treatment gate, the shot list, the look, the still loop, the render as a task, narration, assembly, QA and what to tell the user, through this server\'s tools.',
      arguments: [
        { name: 'brief', description: 'The user\'s description of the piece: what it is for, how long, which frame, the mood, the text that must appear, the subject.', required: true },
        { name: 'outDir', description: `Where the user wants the deliverables, when not the server's own output directory (${paths.outDir}); passed on as a hint, not a setting.`, required: false },
      ],
      get: async (args): Promise<readonly PromptMessage[]> => studioPromptMessages(paths, args),
    },
  ];
}

/** The paragraph the client's model reads at initialize: what the server is, the flow to follow, where files land. */
export function serverInstructions(paths: ServerPaths): string {
  return instructionsText(paths);
}

function studioPromptMessages(paths: ServerPaths, args: Readonly<Record<string, string>>): readonly PromptMessage[] {
  const brief = args['brief']?.trim() ?? '';
  if (brief.length === 0) {
    // A missing or blank brief is a bad argument on the wire: -32602, not an internal error.
    throw new ProtocolError(JsonRpcErrorCodes.invalidParams, `The ${studioPromptName} prompt needs arguments.brief: the user's description of the piece, in their words.`, { field: 'arguments.brief' });
  }
  const outDir = args['outDir']?.trim() ?? '';
  const outDirHint = outDir.length > 0 ? `\n\nThe user wants the deliverables under ${outDir}; the tools write under ${paths.outDir}, so say where the files are and copy them there only when asked.` : '';
  return [{ role: 'user', content: { type: 'text', text: `${directingFlow(paths)}${outDirHint}\n\nThe brief:\n${brief}` } }];
}
