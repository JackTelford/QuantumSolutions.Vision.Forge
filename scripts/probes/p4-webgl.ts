/**
 * Probe P4: which WebGL renderer does each headless system browser use under
 * each `--use-angle` setting, and what does it support?
 *
 * Decides the hardware and software flag sets for the three lane and whether
 * the renderer policy can distinguish them from the renderer string.
 */
import { join, relative } from 'node:path';
import { EvidenceReport, chromePath, edgePath, ensureDir, machineFingerprint, repoRoot, scratchDir, windowsFileVersion } from './lib.ts';
import { availableChannels, baseArgs, closeQuietly, isHardwareRenderer, launchContext, profileDir, readWebglCapabilities, removeProfileDir } from './browser-lib.ts';

interface Variant {
  readonly name: string;
  readonly args: readonly string[];
}

const variants: readonly Variant[] = [
  { name: 'default', args: [] },
  { name: 'd3d11', args: ['--use-angle=d3d11'] },
  { name: 'swiftshader-webgl', args: ['--use-angle=swiftshader-webgl'] },
  { name: 'd3d11-warp-webgl', args: ['--use-angle=d3d11-warp-webgl'] },
];

/** Runs the probe and writes docs/evidence/m0/p4-webgl.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p4-webgl', 'P4: headless WebGL renderer matrix');
  const dir = ensureDir(join(scratchDir, 'p4'));
  report.facts(await machineFingerprint());
  report.paragraph(`Launch: \`chromium.launchPersistentContext\` on the system channel, headless, viewport 1920x1080, deviceScaleFactor 1, args ${JSON.stringify(baseArgs)} plus the variant. Playwright adds \`--force-color-profile=srgb\`, \`--hide-scrollbars\` and \`--enable-unsafe-swiftshader\` itself.`);

  const rows: string[][] = [];
  const decisions: string[] = [];
  for (const channel of availableChannels()) {
    const executable = channel === 'msedge' ? edgePath() : chromePath();
    const version = executable === undefined ? 'unknown' : await windowsFileVersion(executable);
    for (const variant of variants) {
      const profile = profileDir(dir, `${channel}-${variant.name}`);
      const started = Date.now();
      let launchError = '';
      let context;
      try {
        context = await launchContext({ channel, profileDir: profile, args: [...baseArgs, ...variant.args] });
      } catch (error: unknown) {
        launchError = error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error);
      }
      if (context === undefined) {
        rows.push([channel, version, variant.name, 'LAUNCH FAILED', launchError, '', '', '', '', '', '']);
        continue;
      }
      try {
        const page = await context.newPage();
        const caps = await readWebglCapabilities(page);
        const launchMs = Date.now() - started;
        rows.push([
          channel, version, variant.name,
          caps.ok ? 'ok' : `FAIL ${caps.error}`,
          caps.renderer,
          caps.webgl2 ? 'yes' : 'no',
          caps.extColorBufferFloat ? 'yes' : 'no',
          caps.oesTextureFloatLinear ? 'yes' : 'no',
          String(caps.maxTextureSize),
          `${caps.firstFrameMs.toFixed(1)} ms / launch ${launchMs} ms`,
          isHardwareRenderer(caps.renderer) ? 'hardware' : 'software',
        ]);
        if (variant.name === 'default') {
          decisions.push(`${channel}: default renderer is "${caps.renderer}" (${isHardwareRenderer(caps.renderer) ? 'hardware' : 'software'}).`);
        }
      } finally {
        await closeQuietly(context);
        await removeProfileDir(profile);
      }
    }
  }

  report.heading('Renderer matrix');
  report.table(['Channel', 'Version', 'Variant', 'Context', 'UNMASKED_RENDERER_WEBGL', 'WebGL2', 'EXT_color_buffer_float', 'OES_texture_float_linear', 'MAX_TEXTURE_SIZE', 'First frame / launch', 'Class'], rows);
  report.heading('Conclusion');
  for (const line of decisions) report.paragraph(line);
  const hardwareRows = rows.filter((r) => r[10] === 'hardware');
  report.paragraph(hardwareRows.length > 0
    ? `Hardware rendering is available: ${hardwareRows.map((r) => `${r[0]}/${r[2]}`).join(', ')}. The harness should pass an explicit \`--use-angle=d3d11\` for the hardware policy and \`--use-angle=swiftshader-webgl\` for the software policy, and verify the renderer string at startup.`
    : 'No variant produced a hardware renderer. The three lane would run on a software rasterizer on this machine.');
  report.unverified('Rendering throughput at 1080p with SSAA and post-processing was not measured here (P5 measures screenshot time; the three lane measures its own frame time in M4).');
  const path = report.write();
  process.stdout.write(`wrote ${relative(repoRoot, path)}\n`);
}
