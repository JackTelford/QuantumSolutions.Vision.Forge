/**
 * The Blender probe: one Python expression, run in background mode with the
 * factory configuration, that prints a single `PROBE {json}` line with the
 * facts the Blender lane depends on (ADR 0004). There is no Python file; the
 * expression lives here so the one Python file stays the scene applier.
 */
import type { ProcessRunner } from '../process/process-runner.ts';
import { stderrTail } from '../process/process-runner.ts';

/** What the probe reports. */
export interface BlenderProbe {
  readonly versionString: string;
  readonly python: string;
  readonly engines: readonly string[];
  readonly computeDeviceTypes: readonly string[];
  readonly devices: readonly { readonly name: string; readonly type: string }[];
  readonly actionSlots: boolean;
  readonly mediaType: boolean;
}

/**
 * The probe either reported (with a warning when Blender exited non-zero
 * after printing its report, the teardown crash ADR 0004 documents), or
 * failed with a sentence doctor records as a problem.
 */
export type BlenderProbeResult =
  | { readonly ok: true; readonly probe: BlenderProbe; readonly warning?: string }
  | { readonly ok: false; readonly problem: string };

/** The prefix of the one line the probe prints. */
export const probeLinePrefix = 'PROBE ';

/** The exit code `--python-exit-code` makes a Python exception produce. */
export const pythonExitCode = 3;

/** How long the probe may take, including Blender's startup. */
export const probeTimeoutMs = 120_000;

/**
 * The Python the probe runs, as `exec` of a string so the argument is one
 * line with no raw newlines or double quotes. `bl_rna.properties` is used
 * for feature checks because `hasattr` never sees RNA properties.
 */
export const blenderProbeExpression: string = `exec("${[
  'import bpy, sys, json',
  'o = {}',
  "o['version_string'] = bpy.app.version_string",
  "o['python'] = sys.version",
  "o['engines'] = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]",
  "o['compute_types'] = []",
  "o['devices'] = []",
  'try:',
  "    p = bpy.context.preferences.addons['cycles'].preferences",
  "    o['compute_types'] = [t[0] for t in p.get_device_types(bpy.context)]",
  '    p.refresh_devices()',
  "    o['devices'] = [[d.name, d.type] for d in p.devices]",
  'except Exception as e:',
  "    o['cycles_error'] = str(e)",
  "o['action_slots'] = 'slots' in bpy.types.Action.bl_rna.properties",
  "o['media_type'] = 'media_type' in bpy.types.ImageFormatSettings.bl_rna.properties",
  `print('${probeLinePrefix}' + json.dumps(o))`,
  'sys.stdout.flush()',
].join('\\n')}")`;

/** The argument array the probe runs with (golden-tested): background, factory settings, no autoexec, no audio, exceptions exit 3. */
export const blenderProbeArgs: readonly string[] = ['-b', '--factory-startup', '--disable-autoexec', '-noaudio', '--python-exit-code', String(pythonExitCode), '--python-expr', blenderProbeExpression];

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseDevices(value: unknown): readonly { readonly name: string; readonly type: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const devices: { readonly name: string; readonly type: string }[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') return undefined;
    devices.push({ name: item[0], type: item[1] });
  }
  return devices;
}

/** Finds the `PROBE {json}` line in the probe's output and turns it into a report, or explains why it could not. */
export function parseBlenderProbe(stdout: string): BlenderProbeResult {
  const line = stdout.split(/\r?\n/).map((text) => text.trim()).find((text) => text.startsWith(probeLinePrefix));
  if (line === undefined) return { ok: false, problem: 'the Blender probe printed no PROBE line; Blender started but its Python did not run the probe.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(probeLinePrefix.length));
  } catch {
    return { ok: false, problem: 'the Blender probe printed a PROBE line that is not JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, problem: 'the Blender probe printed a PROBE line that is not a JSON object.' };
  const record = parsed as Record<string, unknown>;
  const devices = parseDevices(record['devices']);
  if (typeof record['version_string'] !== 'string' || typeof record['python'] !== 'string' || !isStringArray(record['engines']) || !isStringArray(record['compute_types']) || devices === undefined || typeof record['action_slots'] !== 'boolean' || typeof record['media_type'] !== 'boolean') {
    return { ok: false, problem: 'the Blender probe printed a PROBE line without the expected fields (version_string, python, engines, compute_types, devices, action_slots, media_type).' };
  }
  return {
    ok: true,
    probe: {
      versionString: record['version_string'],
      python: record['python'],
      engines: record['engines'],
      computeDeviceTypes: record['compute_types'],
      devices,
      actionSlots: record['action_slots'],
      mediaType: record['media_type'],
    },
  };
}

/** `3221225477` for a numeric exit code, `none (killed)` when the process died of a signal. */
function describeExitCode(exitCode: number | null): string {
  return exitCode === null ? 'none (killed)' : String(exitCode);
}

/**
 * Runs the probe against the Blender at the path. A failed probe is a
 * result, never an exception. The PROBE line is read before the exit code:
 * Blender 5.2.3 can crash with 0xC0000005 at teardown after successful work
 * (ADR 0004, issue #165595), and such a run is reported as ok with a warning
 * that names the exit code. The exit-code sentences apply only when no valid
 * PROBE line was printed.
 */
export async function runBlenderProbe(runner: ProcessRunner, executable: string, signal: AbortSignal = new AbortController().signal): Promise<BlenderProbeResult> {
  const result = await runner.run({ label: 'blender', executable, args: blenderProbeArgs, timeoutMs: probeTimeoutMs }, signal);
  if (result.timedOut) return { ok: false, problem: `the Blender probe did not finish within ${Math.round(probeTimeoutMs / 1000)} s and was stopped.` };
  const parsed = parseBlenderProbe(result.stdout);
  const tail = stderrTail(result.stderr);
  if (parsed.ok) {
    if (result.exitCode === 0) return parsed;
    return { ok: true, probe: parsed.probe, warning: `the Blender probe printed its report but Blender then exited with code ${describeExitCode(result.exitCode)}${tail.length > 0 ? ` (${tail})` : ''}; the lane stays open because renders tolerate this teardown crash (ADR 0004).` };
  }
  if (result.exitCode === pythonExitCode) {
    return { ok: false, problem: `the Blender probe raised a Python exception (exit ${pythonExitCode})${tail.length > 0 ? `: ${tail}` : '.'}` };
  }
  if (result.exitCode !== 0) {
    return { ok: false, problem: `the Blender probe exited with code ${describeExitCode(result.exitCode)}${tail.length > 0 ? `: ${tail}` : '.'}` };
  }
  return parsed;
}
