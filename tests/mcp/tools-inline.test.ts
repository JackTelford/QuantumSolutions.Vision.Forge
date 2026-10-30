import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PlanData } from '../../src/cli/commands/plan.ts';
import type { ValidateData } from '../../src/cli/commands/validate.ts';
import { failureResult, successResult } from '../../src/cli/result.ts';
import type { CliResult } from '../../src/cli/result.ts';
import { runCommand } from '../../src/cli/run.ts';
import { ExitCodes } from '../../src/errors/vision-forge-error.ts';
import { readJsonFile, writeJsonAtomic } from '../../src/fs/atomic-json.ts';
import { imageContent, maxEncodedImageBytes } from '../../src/mcp/tools/images.ts';
import { commandTools } from '../../src/mcp/tools/index.ts';
import { documentsDir, writeInlineDocument, writeInlineDocuments, writeInlineText } from '../../src/mcp/tools/inline-documents.ts';
import { attachStill, stillGateCode } from '../../src/mcp/tools/render-tools.ts';
import { TaskTable } from '../../src/mcp/tools/tasks.ts';
import type { ServerPaths, ToolCallContext, ToolDefinition } from '../../src/mcp/types.ts';
import { jobId } from '../../src/plan/job.ts';
import { solidPngBytes, writeSolidPng } from '../fakes/png.ts';
import { planBrief, planLook, planShotSpec, planTreatment } from '../plan/fixtures.ts';
import { briefExample, mutated } from '../schema/documents/examples.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const never = new AbortController().signal;

describe('inline documents through the tools', () => {
  let dir = '';
  let paths: ServerPaths;
  let tools: readonly ToolDefinition[];
  const lines: string[] = [];
  let context: ToolCallContext;
  const tool = (name: string): ToolDefinition => {
    const found = tools.find((entry) => entry.name === name);
    assert.ok(found !== undefined, name);
    return found;
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-mcp-inline-'));
    paths = { dataDir: join(dir, 'data'), outDir: join(dir, 'out'), repositoryRoot: repoRoot };
    tools = commandTools(paths, new TaskTable());
    context = { signal: never, report: (message) => { lines.push(message); }, ...paths };
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('plans the four fixture documents inline into the job folder the CLI plans the same files into, under the same id', async () => {
    const byHand = join(dir, 'by-hand');
    writeJsonAtomic(join(byHand, 'brief.json'), planBrief);
    writeJsonAtomic(join(byHand, 'treatment.json'), planTreatment);
    writeJsonAtomic(join(byHand, 'shot-spec.json'), planShotSpec);
    writeJsonAtomic(join(byHand, 'look.json'), planLook);
    const cli = await runCommand(['plan', '--brief', 'brief.json', '--treatment', 'treatment.json', '--shot-spec', 'shot-spec.json', '--look', 'look.json'], { signal: never, dataDir: paths.dataDir, outDir: join(dir, 'out-cli'), cwd: byHand });
    assert.equal(cli.ok, true, JSON.stringify(cli.errors));
    const expectedId = (cli.data as PlanData).jobId;
    assert.equal(expectedId, await jobId(planBrief, planTreatment, planShotSpec, planLook));

    const result = await tool('plan').run({ brief: planBrief, treatment: planTreatment, shotSpec: planShotSpec, look: planLook }, context);
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    const document = result.structuredContent as unknown as CliResult;
    const data = document.data as PlanData;
    assert.equal(data.jobId, expectedId);
    assert.equal(data.jobDir, join(paths.outDir, expectedId));
    assert.ok(existsSync(join(data.jobDir, 'job.json')));
    assert.deepEqual(data.shots.map((shot) => shot.key), (cli.data as PlanData).shots.map((shot) => shot.key), 'the same documents key every shot alike');
    for (const name of ['brief.json', 'treatment.json', 'shot-spec.json', 'look-bible.json']) assert.ok(existsSync(join(documentsDir(paths.outDir), expectedId, name)), `inline ${name} under <out>/documents/<job id>/`);
    assert.deepEqual(readJsonFile(join(documentsDir(paths.outDir), expectedId, 'shot-spec.json')), planShotSpec);
    assert.ok(lines.some((line) => /3 shots, 300 frames/.test(line)), 'the command log reached the client');
    assert.equal(JSON.parse((result.content[0] as { text: string }).text).data.jobId, expectedId);
  });

  it('plans a mix of paths and inline documents into the same job id', async () => {
    const briefPath = join(paths.outDir, 'mixed', 'brief.json');
    writeJsonAtomic(briefPath, planBrief);
    const result = await tool('plan').run({ brief: 'mixed/brief.json', treatment: planTreatment, shotSpec: planShotSpec, look: planLook }, context);
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    assert.equal(((result.structuredContent as unknown as CliResult).data as PlanData).jobId, await jobId(planBrief, planTreatment, planShotSpec, planLook));
  });

  it('refuses a plan input that is neither a path nor an object, or is missing, as a usage failure', async () => {
    const wrong = await tool('plan').run({ brief: 7, treatment: planTreatment, shotSpec: planShotSpec, look: planLook }, context);
    assert.equal(wrong.isError, true);
    assert.match((wrong.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /"brief" must be an object/);
    const missing = await tool('plan').run({ brief: planBrief, treatment: planTreatment, shotSpec: planShotSpec }, context);
    assert.equal(missing.isError, true);
    assert.match((missing.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /Missing "look"/);
  });

  it('validates a valid document inline and reports its kind and the written path', async () => {
    const result = await tool('validate').run({ document: briefExample }, context);
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    const data = (result.structuredContent as unknown as CliResult).data as ValidateData;
    assert.equal(data.kind, 'brief');
    assert.equal(dirname(data.path), documentsDir(paths.outDir));
    assert.match(data.path, /validate-[0-9a-f]{8}\.json$/);
    assert.deepEqual(readJsonFile(data.path), briefExample);
  });

  it('validates an invalid document inline with code schema-validation, and refuses path and document together', async () => {
    const result = await tool('validate').run({ document: mutated(briefExample, (copy) => { copy.durationSeconds = -1; }) }, context);
    assert.equal(result.isError, true);
    const document = result.structuredContent as unknown as CliResult;
    assert.equal(document.errors[0]?.code, 'schema-validation');
    assert.match(document.errors[0]?.message ?? '', /brief document is invalid/);
    const both = await tool('validate').run({ path: 'x.json', document: briefExample }, context);
    assert.match((both.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /Pass "path" or "document", not both/);
    const neither = await tool('validate').run({}, context);
    assert.match((neither.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /Missing the file to validate/);
  });

  it('writes a partial quartet under its own hash, a single document under a label, and text as UTF-8', async () => {
    const partial = await writeInlineDocuments(paths.outDir, { look: planLook });
    assert.deepEqual(Object.keys(partial), ['look']);
    assert.match(partial.look ?? '', /[\\/]documents[\\/][0-9a-f]{8}[\\/]look-bible\.json$/);
    assert.notEqual(dirname(partial.look ?? ''), join(documentsDir(paths.outDir), await jobId(planBrief, planTreatment, planShotSpec, planLook)));
    assert.deepEqual(await writeInlineDocuments(paths.outDir, {}), {});
    const single = await writeInlineDocument(paths.outDir, 'validate', { kind: 'x' });
    assert.equal(single, await writeInlineDocument(paths.outDir, 'validate', { kind: 'x' }), 'equal content, equal path');
    const text = await writeInlineText(paths.outDir, 'narration', 'Ünïcode sentence. Another one.');
    assert.match(text, /narration-[0-9a-f]{8}\.txt$/);
    assert.equal(readFileSync(text, 'utf8'), 'Ünïcode sentence. Another one.');
  });

  it('writes an inline script for audio_synth and refuses it beside text or script', async () => {
    const both = await tool('audio_synth').run({ scriptText: 'One.', text: 'Two.' }, context);
    assert.match((both.structuredContent as unknown as CliResult).errors[0]?.message ?? '', /Pass one of "text", "script" or "scriptText"/);
    const result = await tool('audio_synth').run({ scriptText: 'A sentence to read.' }, context);
    assert.equal(result.isError, true, 'narration is not installed in the test data directory');
    const expected = await writeInlineText(paths.outDir, 'narration', 'A sentence to read.');
    assert.ok(existsSync(expected), 'the script was written before the command ran');
    const code = (result.structuredContent as unknown as CliResult).errors[0]?.code;
    assert.ok(code !== 'usage' && code !== 'path-not-allowed', `the command took the script path: ${code}`);
  });
});

describe('image content', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'vf-mcp-images-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns a PNG as base64 image content', async () => {
    const path = join(dir, 'still.png');
    writeSolidPng(path, 4, 3, [10, 20, 30]);
    const content = await imageContent(path, 'the finished still');
    assert.equal(content.type, 'image');
    if (content.type !== 'image') return;
    assert.equal(content.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(content.data, 'base64'), solidPngBytes(4, 3, [10, 20, 30]));
  });

  it('replaces a missing file, a non-image and an image over 4 MB encoded with a sentence naming the path', async () => {
    const missing = await imageContent(join(dir, 'nope.png'), 'the contact sheet');
    assert.equal(missing.type, 'text');
    assert.match((missing as { text: string }).text, /^The contact sheet at .*nope\.png could not be read/);
    const other = await imageContent(join(dir, 'report.json'), 'the report');
    assert.match((other as { text: string }).text, /only PNG and JPEG images are sent inline/);
    const big = join(dir, 'big.jpg');
    writeFileSync(big, Buffer.alloc(Math.ceil(maxEncodedImageBytes * 3 / 4) + 16));
    const large = await imageContent(big, 'the finished still');
    assert.equal(large.type, 'text');
    assert.match((large as { text: string }).text, /over the 4 MB limit for inline images; open it from the path/);
  });

  it('attaches the still that failed the gate from the still-gate failure document, and nothing for any other failure', async () => {
    const stillPath = join(dir, 'stills', 's01-r1.png');
    writeSolidPng(stillPath, 4, 3, [90, 90, 90]);
    const reportPath = join(dir, 'stills', 's01-r1.gate.json');
    const gateFailure = failureResult('still', ExitCodes.failure, { code: stillGateCode, message: 'The still of shot "s01" failed the gate: exposure.', hint: 'Fix the shot spec or the look (never the still) and run still again.' }, [reportPath, stillPath]);
    const attached = await attachStill(gateFailure);
    assert.equal(attached.length, 1);
    const image = attached[0];
    assert.equal(image?.type, 'image');
    if (image?.type !== 'image') return;
    assert.equal(image.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(image.data, 'base64'), solidPngBytes(4, 3, [90, 90, 90]));
    const otherFailure = failureResult('still', ExitCodes.failure, { code: 'lane-unavailable', message: 'No browser.', hint: 'Run doctor.' }, [reportPath, stillPath]);
    assert.deepEqual(await attachStill(otherFailure), []);
    const noImage = failureResult('still', ExitCodes.failure, { code: stillGateCode, message: 'failed', hint: 'fix' }, [reportPath]);
    assert.deepEqual(await attachStill(noImage), []);
    const passed = await attachStill(successResult('still', { data: { stillPath } }));
    assert.equal(passed[0]?.type, 'image');
  });
});
