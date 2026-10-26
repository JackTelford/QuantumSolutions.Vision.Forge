/**
 * Probe P3: can a system browser load shared TypeScript served through Node's
 * stripper plus an import map that points at the real three package?
 *
 * Also records what happens with file:// module loading (expected: blocked)
 * and with a decorator reaching the browser (expected: loud syntax error).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EvidenceReport, ensureDir, repoRoot, scratchDir, windowsFileVersion, chromePath, edgePath } from './lib.ts';
import { availableChannels, baseArgs, closeQuietly, launchContext, profileDir, removeProfileDir, startStaticServer } from './browser-lib.ts';

const typesSource = 'export interface Scene { readonly fps: number; }\n';
const timingSource = 'export function frameToSeconds(frame: number, fps: number): number { return frame / fps; }\n';
const mainSource = [
  "import type { Scene } from '../shared/types.ts';",
  "import { frameToSeconds } from '../shared/timing.ts';",
  "import { REVISION } from 'three';",
  "import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';",
  "import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';",
  '',
  'const scene: Scene = { fps: 30 };',
  'const seconds: number = frameToSeconds(30, scene.fps);',
  "document.title = `OK ${seconds} r${REVISION} ${typeof EffectComposer} ${typeof SSAARenderPass}`;",
  '',
].join('\n');
const decoSource = 'function dec<T>(target: T): T { return target; }\n@dec class Decorated {}\ndocument.title = `DECORATOR RAN ${typeof Decorated}`;\n';

function pageHtml(entry: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>loading</title>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/","three/examples/jsm/":"/vendor/three/examples/jsm/"}}</script>
</head><body><script type="module" src="${entry}"></script></body></html>`;
}

/** Runs the probe and writes docs/evidence/m0/p3-tsserve.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p3-tsserve', 'P3: TypeScript served to the browser with an import map');
  const dir = ensureDir(join(scratchDir, 'p3'));
  const appDir = ensureDir(join(dir, 'site'));
  mkdirSync(join(appDir, 'shared'), { recursive: true });
  mkdirSync(join(appDir, 'app'), { recursive: true });
  writeFileSync(join(appDir, 'shared', 'types.ts'), typesSource, 'utf8');
  writeFileSync(join(appDir, 'shared', 'timing.ts'), timingSource, 'utf8');
  writeFileSync(join(appDir, 'app', 'main.ts'), mainSource, 'utf8');
  writeFileSync(join(appDir, 'app', 'deco.ts'), decoSource, 'utf8');
  writeFileSync(join(appDir, 'index.html'), pageHtml('/site/app/main.ts'), 'utf8');
  writeFileSync(join(appDir, 'deco.html'), pageHtml('/site/app/deco.ts'), 'utf8');

  let experimentalWarning = 'none observed';
  process.on('warning', (warning: Error) => {
    if (warning.name === 'ExperimentalWarning') experimentalWarning = warning.message;
  });

  const server = await startStaticServer([
    { urlPrefix: '/site/', directory: appDir },
    { urlPrefix: '/vendor/three/', directory: join(repoRoot, 'node_modules', 'three') },
  ]);
  report.paragraph(`Static server on ${server.url}: \`.ts\` files are stripped with \`node:module\` \`stripTypeScriptTypes\` and served as \`text/javascript\` with \`nosniff\`; \`/vendor/three/\` maps to the real \`node_modules/three\` directory.`);

  const traversal = await fetch(`${server.url}/site/..%2F..%2Fpackage.json`);
  const stripped = await fetch(`${server.url}/site/app/main.ts`);
  const strippedText = await stripped.text();
  report.heading('Server behavior');
  report.table(['Check', 'Result'], [
    ['GET /site/app/main.ts content-type', stripped.headers.get('content-type') ?? ''],
    ['stripped output keeps .ts specifiers', String(strippedText.includes("'../shared/timing.ts'"))],
    ['stripped output erases import type', String(!strippedText.includes('import type'))],
    ['path traversal /site/..%2F..%2Fpackage.json', `${traversal.status}`],
    ['ExperimentalWarning from stripTypeScriptTypes', experimentalWarning],
  ]);

  const rows: string[][] = [];
  const channels = availableChannels();
  for (const channel of channels) {
    const executable = channel === 'msedge' ? edgePath() : chromePath();
    const version = executable === undefined ? 'unknown' : await windowsFileVersion(executable);
    const profile = profileDir(dir, channel);
    const context = await launchContext({ channel, profileDir: profile, args: baseArgs });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

      const started = Date.now();
      await page.goto(`${server.url}/site/index.html`, { waitUntil: 'load' });
      let title = '';
      try {
        await page.waitForFunction('document.title.startsWith("OK ")', undefined, { timeout: 20_000 });
        title = await page.title();
      } catch {
        title = `TIMEOUT (title was "${await page.title()}")`;
      }
      rows.push([channel, version, 'http import map + real three', title, `${Date.now() - started} ms`, errors.join(' | ') || 'none']);

      errors.length = 0;
      const fileUrl = `file:///${join(appDir, 'index.html').replace(/\\/g, '/')}`;
      await page.goto(fileUrl, { waitUntil: 'load' }).catch((error: Error) => errors.push(`goto: ${error.message}`));
      await page.waitForTimeout(1500);
      rows.push([channel, version, 'file:// module load', await page.title(), '', errors.join(' | ') || 'none']);

      errors.length = 0;
      await page.goto(`${server.url}/site/deco.html`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      rows.push([channel, version, 'decorator through strip-on-serve', await page.title(), '', errors.join(' | ') || 'none']);
    } finally {
      await closeQuietly(context);
      await removeProfileDir(profile);
    }
  }
  await server.close();

  report.heading('Browser results');
  report.table(['Channel', 'Version', 'Case', 'document.title', 'Time', 'Errors'], rows);
  const httpOk = rows.filter((r) => r[2] === 'http import map + real three').every((r) => r[3]?.startsWith('OK '));
  report.heading('Conclusion');
  report.paragraph(httpOk
    ? 'Every available channel executed shared TypeScript stripped on the fly and imported three plus two addons through the import map.'
    : 'At least one channel failed to load the stripped TypeScript; see the Errors column.');
  report.paragraph(`Probe site: \`${relative(repoRoot, appDir)}\`.`);
  if (channels.length < 2) report.unverified('Only one browser channel was available on this machine.');
  report.unverified('The harness server will run as its own child process with --disable-warning=ExperimentalWarning; this probe ran the server in-process to capture the warning.');
  const path = report.write();
  process.stdout.write(`wrote ${relative(repoRoot, path)}\n`);
  if (!httpOk) process.exitCode = 1;
}
