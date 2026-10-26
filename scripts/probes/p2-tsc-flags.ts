/**
 * Probe P2: does the pinned TypeScript honor the flags this repository relies on?
 *
 * Writes a throwaway project under .tmp/p2 with one positive sample and a set
 * of negative samples, runs `tsc -p` on each through node.exe (never tsc.cmd),
 * and records whether every sample was accepted or rejected as expected under
 * both the Node and the browser configuration.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EvidenceReport, ensureDir, repoRoot, runCommand, scratchDir } from './lib.ts';

interface Sample {
  readonly file: string;
  readonly source: string;
  /** 'node' | 'browser' | 'both' */
  readonly config: 'node' | 'browser' | 'both';
  readonly expectReject: boolean;
  readonly why: string;
}

const samples: readonly Sample[] = [
  {
    file: 'ok.ts',
    source: [
      "import type { Shape } from './shape.ts';",
      "import { area } from './shape.ts';",
      "export const Lanes = { html: 'html', three: 'three', blender: 'blender' } as const;",
      'export type Lane = (typeof Lanes)[keyof typeof Lanes];',
      'export class Box { readonly width: number; constructor(width: number) { this.width = width; } }',
      'export function describe(shape: Shape): string { return `${shape.kind}:${area(shape)}`; }',
      "export const lane = 'html' satisfies Lane;",
      '',
    ].join('\n'),
    config: 'both',
    expectReject: false,
    why: 'erasable syntax only, import type, .ts extensions, as const unions, explicit fields',
  },
  { file: 'enum.ts', source: 'export enum Mode { A, B }\n', config: 'both', expectReject: true, why: 'enum is not erasable' },
  { file: 'namespace.ts', source: 'export namespace Util { export const x = 1; }\n', config: 'both', expectReject: true, why: 'namespace with runtime code is not erasable' },
  { file: 'param-prop.ts', source: 'export class P { constructor(private readonly x: number) {} }\n', config: 'both', expectReject: true, why: 'parameter property is not erasable' },
  { file: 'angle-cast.ts', source: 'export const n = <number>(1 as unknown);\n', config: 'both', expectReject: true, why: 'angle-bracket assertion is not erasable' },
  { file: 'import-equals.ts', source: "import fs = require('node:fs');\nexport const f = fs;\n", config: 'node', expectReject: true, why: 'import = require is not erasable' },
  { file: 'no-extension.ts', source: "import { area } from './shape';\nexport const a = area({ kind: 'square', side: 2 });\n", config: 'both', expectReject: true, why: 'relative import without .ts extension' },
  { file: 'type-without-keyword.ts', source: "import { Shape } from './shape.ts';\nexport const s: Shape = { kind: 'square', side: 1 };\n", config: 'both', expectReject: true, why: 'type imported without the type keyword under verbatimModuleSyntax' },
  { file: 'decorator.ts', source: 'function dec<T>(c: T): T { return c; }\n@dec export class D {}\n', config: 'both', expectReject: false, why: 'decorators are NOT flagged by erasableSyntaxOnly (lint must catch them)' },
  { file: 'inline-type-specifier.ts', source: "import { type Shape, area } from './shape.ts';\nexport const a = (s: Shape): number => area(s);\n", config: 'both', expectReject: false, why: 'inline type specifier is accepted by tsc (house rule enforced by lint)' },
  { file: 'dom-in-node.ts', source: 'export const t = document.title;\n', config: 'node', expectReject: true, why: 'DOM global must not type-check under the node config' },
  { file: 'process-in-browser.ts', source: 'export const p = process.platform;\n', config: 'browser', expectReject: true, why: 'Node global must not type-check under the browser config' },
  { file: 'any.ts', source: 'export function f(x: any): any { return x; }\n', config: 'both', expectReject: false, why: 'tsc accepts explicit any (lint must catch it); noImplicitAny only catches implicit any' },
  { file: 'unchecked-index.ts', source: 'export function first(xs: string[]): string { return xs[0]; }\n', config: 'both', expectReject: true, why: 'noUncheckedIndexedAccess makes xs[0] string | undefined' },
];

const shapeSource = [
  "export type Shape = { kind: 'square'; side: number } | { kind: 'circle'; radius: number };",
  'export function area(shape: Shape): number {',
  "  return shape.kind === 'square' ? shape.side * shape.side : Math.PI * shape.radius * shape.radius;",
  '}',
  '',
].join('\n');

/** Runs the probe and writes docs/evidence/m0/p2-tsc-flags.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p2-tsc-flags', 'P2: TypeScript flag behavior');
  const dir = ensureDir(join(scratchDir, 'p2'));
  const tscPath = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const version = await runCommand(process.execPath, [tscPath, '--version']);
  report.facts({ typescript: version.stdout.trim(), node: process.version });
  report.paragraph('Each sample is compiled alone with `tsc -p` through node.exe (never tsc.cmd) under a config that extends the repository `tsconfig.base.json`. "Expected" is what the repository relies on; "Observed" is what this TypeScript did.');

  writeFileSync(join(dir, 'shape.ts'), shapeSource, 'utf8');
  const baseConfig = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };
  const rows: string[][] = [];
  let mismatches = 0;

  for (const sample of samples) {
    writeFileSync(join(dir, sample.file), sample.source, 'utf8');
    const configs: ('node' | 'browser')[] = sample.config === 'both' ? ['node', 'browser'] : [sample.config];
    for (const config of configs) {
      const configPath = join(dir, `tsconfig.${config}.${sample.file}.json`);
      const compilerOptions: Record<string, unknown> = {
        ...baseConfig.compilerOptions,
        ...(config === 'node' ? { lib: ['esnext'], types: ['node'], typeRoots: [join(repoRoot, 'node_modules', '@types')] } : { lib: ['esnext', 'dom', 'dom.iterable'], types: [] }),
      };
      writeFileSync(configPath, JSON.stringify({ compilerOptions, files: [join(dir, sample.file), join(dir, 'shape.ts')] }, null, 2), 'utf8');
      const result = await runCommand(process.execPath, [tscPath, '-p', configPath], { timeoutMs: 120_000 });
      const rejected = result.exitCode !== 0;
      const firstError = result.stdout.split(/\r?\n/).find((l) => l.includes('error TS')) ?? '';
      const match = rejected === sample.expectReject;
      if (!match) mismatches += 1;
      rows.push([
        sample.file,
        config,
        sample.expectReject ? 'reject' : 'accept',
        rejected ? 'reject' : 'accept',
        match ? 'ok' : 'MISMATCH',
        firstError.replace(/^.*?error /, 'error ').slice(0, 140),
        sample.why,
      ]);
    }
  }

  report.heading('Sample matrix');
  report.table(['Sample', 'Config', 'Expected', 'Observed', 'Match', 'First error', 'Why it matters'], rows);
  report.heading('Conclusion');
  report.paragraph(mismatches === 0
    ? `All ${rows.length} checks behaved as the repository expects with TypeScript ${version.stdout.trim()}.`
    : `${mismatches} of ${rows.length} checks did not behave as expected. Review the MISMATCH rows before relying on this TypeScript version.`);
  report.paragraph(`Scratch project: \`${relative(repoRoot, dir)}\`.`);
  report.unverified('Decorators and inline type specifiers are accepted by tsc by design; scripts/lint.ts (M0b) must reject them.');
  const path = report.write();
  process.stdout.write(`wrote ${relative(repoRoot, path)} (${mismatches} mismatches)\n`);
  if (mismatches > 0) process.exitCode = 1;
}
