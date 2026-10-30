/**
 * The tools before anything renders: doctor, validate and plan. validate
 * and plan take their documents by path or inline (ADR 0009 decision 4);
 * an inline document is written under `<out>/documents/` and the command
 * reads it from there.
 */
import { UsageError } from '../../errors/vision-forge-error.ts';
import type { ToolCallContext } from '../types.ts';
import { OptionKinds, inputSchema, localWriteAnnotations, objectProperty, pathProperty, readOnlyAnnotations, booleanProperty, stringProperty } from './definitions.ts';
import type { ToolSpec } from './definitions.ts';
import { inlineDocumentKinds, writeInlineDocument, writeInlineDocuments } from './inline-documents.ts';
import type { InlineDocumentKind } from './inline-documents.ts';
import { readRecord, readString } from './inputs.ts';

/** doctor: find the tools, write tools.json, say which lanes can run. */
export const doctorSpec: ToolSpec = {
  name: 'doctor',
  description: 'Finds ffmpeg, a browser (Edge or Chrome), the GPU and Blender, writes tools.json into the data directory and reports which lanes (html, three, blender, audio) can run on this machine. Run it once before plan and again after installing anything. Fails with code tool-missing when a required program is absent or when a lane named in `require` cannot run; the hint says what to install.',
  command: ['doctor'],
  options: [
    { key: 'require', option: 'require', kind: OptionKinds.string },
    { key: 'skipBrowserCheck', option: 'skip-browser-check', kind: OptionKinds.flag },
    { key: 'skipBlenderProbe', option: 'skip-blender-probe', kind: OptionKinds.flag },
  ],
  inputSchema: inputSchema({
    require: stringProperty('A lane the run must be able to use; the call fails with the install hint when it cannot.', ['html', 'three', 'blender', 'audio']),
    skipBrowserCheck: booleanProperty('Skip launching the browser for its WebGL report (faster; the three lane is then reported from the browser version alone).'),
    skipBlenderProbe: booleanProperty('Skip probing Blender for its engines and devices.'),
  }),
  // Not read-only: it writes tools.json into the data directory. Idempotent: the same machine gives the same manifest.
  annotations: { ...localWriteAnnotations, idempotentHint: true },
  exclusive: false,
};

/** validate: one document, by path or inline, against its schema and semantic rules. */
export const validateSpec: ToolSpec = {
  name: 'validate',
  description: 'Checks one pipeline document (brief, treatment, shot spec, look bible, job, assembly plan, QA report or assets ledger) against its schema and the semantic rules of its kind. Pass `path` for a file or `document` for the JSON inline (written under <out>/documents/validate-<hash>.json first). Asset ids named in a brief or shot spec must already be in the ledger under the data directory (run assets first). A failure with code schema-validation lists every problem as a sentence.',
  command: ['validate'],
  options: [{ key: 'path', option: '', kind: OptionKinds.positionalPath }],
  inputSchema: inputSchema({
    path: pathProperty('The JSON file to validate.'),
    document: objectProperty('The document itself, instead of `path`; it is written under the output directory and validated from there.'),
  }),
  // Read-only as the client sees it: the only file written is a copy of the client's own inline document under <out>/documents/.
  annotations: readOnlyAnnotations,
  exclusive: false,
  inlineKeys: ['document'],
  prepare: prepareValidate,
};

async function prepareValidate(input: Readonly<Record<string, unknown>>, context: ToolCallContext): Promise<Record<string, unknown>> {
  const document = readRecord(input, 'document');
  const path = readString(input, 'path');
  if (document === undefined) return { ...input };
  if (path !== undefined) throw new UsageError('Pass "path" or "document", not both.', 'Name the file with "path", or pass the JSON inline with "document".');
  const { document: _inline, ...rest } = input;
  return { ...rest, path: await writeInlineDocument(context.outDir, 'validate', document) };
}

const planDocumentDescriptions: Readonly<Record<InlineDocumentKind, string>> = {
  brief: 'The approved brief: a path to its JSON file, or the document inline.',
  treatment: 'The approved treatment: a path or the document inline.',
  shotSpec: 'The approved shot spec: a path or the document inline.',
  look: 'The approved look bible: a path or the document inline.',
};

const planOptionNames: Readonly<Record<InlineDocumentKind, string>> = { brief: 'brief', treatment: 'treatment', shotSpec: 'shot-spec', look: 'look' };

/** plan: the four documents, each by path or inline, into a job folder. */
export const planSpec: ToolSpec = {
  name: 'plan',
  description: 'Validates the brief, treatment, shot spec and look bible, checks them against each other (ids, beats and lanes, fps and size, the transition arithmetic, the pacing rules) and runs the composition solver\'s geometric checks on every shot; writes <out>/<jobId>/ with copies of the four documents and job.json (evidence[0]), one key per shot. Each document is a path or the JSON inline (inline ones are written under <out>/documents/<hash>/ first); the job id is the first eight characters of the content hash of the four, so the same documents plan into the same folder and an edited one into a new one. data.warnings lists pacing and composition warnings: repeat them to the user. Failure codes cross-document and schema-validation list every problem: fix the documents, never the job folder. Run assets before plan when the brief or shot spec names asset ids.',
  command: ['plan'],
  options: inlineDocumentKinds.map((kind) => ({ key: kind, option: planOptionNames[kind], kind: OptionKinds.path })),
  inputSchema: inputSchema(
    Object.fromEntries(inlineDocumentKinds.map((kind) => [kind, { description: planDocumentDescriptions[kind], oneOf: [{ type: 'string' }, { type: 'object' }] }])),
    [...inlineDocumentKinds],
  ),
  annotations: localWriteAnnotations,
  exclusive: false,
  prepare: preparePlan,
};

async function preparePlan(input: Readonly<Record<string, unknown>>, context: ToolCallContext): Promise<Record<string, unknown>> {
  const inline: Partial<Record<InlineDocumentKind, unknown>> = {};
  const prepared: Record<string, unknown> = { ...input };
  for (const kind of inlineDocumentKinds) {
    const value = input[kind];
    if (value === undefined) throw new UsageError(`Missing "${kind}".`, `Pass "${kind}" as a path to the approved ${planOptionNames[kind]} document or as the document itself.`);
    if (typeof value === 'string') continue;
    inline[kind] = readRecord(input, kind);
  }
  const written = await writeInlineDocuments(context.outDir, inline);
  for (const kind of inlineDocumentKinds) {
    const path = written[kind];
    if (path !== undefined) prepared[kind] = path;
  }
  return prepared;
}

/** The three specs of this group, in the order the flow runs them. */
export const planToolSpecs: readonly ToolSpec[] = [doctorSpec, validateSpec, planSpec];
