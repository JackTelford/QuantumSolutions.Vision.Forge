/**
 * Probe dispatcher: `node scripts/probes/run.ts <probe>`.
 *
 * Each probe module exports `run(): Promise<void>` and writes its evidence to
 * docs/evidence/m0/. Probes are kept in the repository so they can be re-run
 * when Node, a browser, a driver or ffmpeg changes.
 */

/** A probe module: one async entry point that writes an evidence report. */
export interface ProbeModule {
  readonly run: () => Promise<void>;
}

const probes: Readonly<Record<string, () => Promise<ProbeModule>>> = {
  p2: () => import('./p2-tsc-flags.ts'),
  p3: () => import('./p3-tsserve.ts'),
  p4: () => import('./p4-webgl.ts'),
  p5: () => import('./p5-determinism.ts'),
  p6: () => import('./p6-ffmpeg.ts'),
  p7: () => import('./p7-redirects.ts'),
  'm4-calibration': () => import('./m4-calibration.ts'),
  'm4-lookdev': () => import('./m4-lookdev.ts'),
  'm5-acceptance': () => import('./m5-acceptance.ts'),
  'm5-calibration': () => import('./m5-calibration.ts'),
  'm5-lookdev': () => import('./m5-lookdev.ts'),
};

/** Entry point. Exit code 2 on usage error, 1 when a probe throws. */
async function main(argv: readonly string[]): Promise<number> {
  const name = argv[0];
  if (name === undefined || !(name in probes)) {
    process.stderr.write(`Usage: node scripts/probes/run.ts <${Object.keys(probes).join('|')}>\n`);
    return 2;
  }
  const loader = probes[name];
  if (loader === undefined) return 2;
  const module = await loader();
  await module.run();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
