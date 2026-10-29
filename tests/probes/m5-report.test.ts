import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commandBlock, engineRenderTable, exitCodeTable, formatExit, formatSeconds, inBand, lookdevTable } from '../../scripts/probes/m5-report.ts';
import type { EngineRenderRow, ExitCodeRow, LookdevRow } from '../../scripts/probes/m5-report.ts';

const renders: readonly EngineRenderRow[] = [
  { attempt: 'eevee-opengl', samples: 128, exitCode: 0, elapsedMs: 4312.4, yavg: 41.26, nonBlack: true, crashLogNew: false, verdict: 'ok' },
  { attempt: 'eevee-vulkan', samples: 128, exitCode: 3221225477, elapsedMs: 9050, yavg: null, nonBlack: false, crashLogNew: true, verdict: 'blender-render: Blender wrote a crash log' },
  { attempt: 'cycles-OPTIX', samples: 128, exitCode: null, elapsedMs: 61000, yavg: 17.9, nonBlack: false, crashLogNew: false, verdict: 'blender-timeout: Blender was stopped after 61 s.' },
];

const exits: readonly ExitCodeRow[] = [
  { scenario: 'success', exitCode: 0, verdictCode: 'ok', stderrTail: '' },
  { scenario: 'Python exception', exitCode: 3, verdictCode: 'blender-script', stderrTail: 'json.decoder.JSONDecodeError: Expecting value | Error: script failed' },
];

const looks: readonly LookdevRow[] = [
  { look: 'obsidian', toneMapping: 'agx', yavgMin: 30, yavgMax: 60, htmlYavg: 40.7, threeYavg: 47.3, blenderYavg: 44.06, blenderMs: 6120 },
  { look: 'studio-clean', toneMapping: 'standard', yavgMin: 170, yavgMax: 200, htmlYavg: null, threeYavg: 168.6, blenderYavg: 201.2, blenderMs: 5000 },
];

describe('the M5 report formatting', () => {
  it('formats the engine table with the exit code, the wall clock in seconds, the luma and the three checks', () => {
    const expected = [
      '| Attempt | Samples | Exit | Wall clock | Frame YAVG | Non-black | New crash log | Verdict |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| eevee-opengl | 128 | 0 | 4.3 s | 41.3 | yes | no | ok |',
      '| eevee-vulkan | 128 | 3221225477 | 9.1 s | n/a | no | yes | blender-render: Blender wrote a crash log |',
      '| cycles-OPTIX | 128 | none (killed) | 61.0 s | 17.9 | no | no | blender-timeout: Blender was stopped after 61 s. |',
    ].join('\n');
    assert.equal(engineRenderTable(renders), expected);
  });

  it('formats the exit-code matrix with an empty stderr tail named and a pipe in a tail escaped', () => {
    const expected = [
      '| Scenario | Exit | Predicate | stderr tail |',
      '| --- | --- | --- | --- |',
      '| success | 0 | ok | (empty) |',
      '| Python exception | 3 | blender-script | json.decoder.JSONDecodeError: Expecting value \\| Error: script failed |',
    ].join('\n');
    assert.equal(exitCodeTable(exits), expected);
  });

  it('writes a command block with the executable first and one indented line per argument', () => {
    assert.equal(commandBlock('C:\\Blender\\blender.exe', ['-b', '--python-exit-code', '3']), '```text\nC:\\Blender\\blender.exe\n  -b\n  --python-exit-code\n  3\n```');
  });

  it('formats the lookdev table with the band, the three lanes and the in-band verdict of the blender still', () => {
    const expected = [
      '| Look | Tone map | QA band | html still YAVG | three still YAVG | blender still YAVG | In band | blender render |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| obsidian | agx | 30 to 60 | 40.7 | 47.3 | 44.1 | yes | 6.1 s |',
      '| studio-clean | standard | 170 to 200 | n/a | 168.6 | 201.2 | no | 5.0 s |',
    ].join('\n');
    assert.equal(lookdevTable(looks), expected);
  });

  it('is deterministic: the same inputs give the same text twice', () => {
    assert.equal(engineRenderTable(renders), engineRenderTable(renders.map((row) => ({ ...row }))));
    assert.equal(lookdevTable(looks), lookdevTable([...looks]));
  });

  it('names a killed process, prints seconds to one decimal and judges a band inclusively', () => {
    assert.equal(formatExit(null), 'none (killed)');
    assert.equal(formatExit(3), '3');
    assert.equal(formatSeconds(1250), '1.3 s');
    assert.equal(inBand(30, 30, 60), true);
    assert.equal(inBand(60.1, 30, 60), false);
    assert.equal(inBand(null, 30, 60), false);
  });
});
