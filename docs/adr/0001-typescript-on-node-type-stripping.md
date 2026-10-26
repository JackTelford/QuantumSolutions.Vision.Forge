# ADR 0001: TypeScript on Node 24 type stripping, no build step

Status: accepted, 2026-10-26.

## Context

BUILD PROMPT v2 requires everything to be TypeScript that Node runs directly. Node strips types by default since 22.18 and 23.6, and the feature is marked stable since 24.12 ([Node docs](https://nodejs.org/api/typescript.html)). Stripping only erases syntax: `enum`, `namespace` with runtime code, parameter properties, `import x = require()`, `export =` and `<T>expr` casts throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; decorators pass through and fail in the JavaScript parser; relative imports must name their `.ts` extension; `tsconfig.json` is ignored at runtime; `.ts` files under any `node_modules` path are refused.

The owner reviews every line as a C# developer. Enums and constructor-injected fields are the two C# habits the stripper rejects.

Node 26 becomes Active LTS on 2026-10-28 and removed the `transform` mode of `module.stripTypeScriptTypes` ([release schedule](https://github.com/nodejs/Release), [module docs](https://nodejs.org/api/module.html)). Strip mode remains.

TypeScript 7.0 is the native port and has no compiler API yet; the house-rule lint needs `ts.createSourceFile`. TypeScript 6.0.3 is the latest JavaScript release and ships the compiler API.

## Decision

- Runtime: Node `>= 24.12.0`, type stripping with no flags, ES modules (`"type": "module"`). No bundler, no transpiler, no build step.
- Type checking: `typescript` 6.0.3 pinned exactly, `tsc --noEmit` through two configurations that extend `tsconfig.base.json`: `tsconfig.node.json` (`types: ["node"]`, `lib: ["esnext"]`) and `tsconfig.browser.json` (`lib: ["esnext", "dom", "dom.iterable"]`, `types: []`). Both include `src/shared/`, which therefore compiles in both environments.
- Base flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `rewriteRelativeImportExtensions`, `allowImportingTsExtensions`, `module: nodenext`, `target: esnext`, `noEmit`.
- House rules enforced by `scripts/lint.ts` (M0b) because `tsc` accepts them: no decorators, `import type` only (never `import { type X }`, which leaves a side-effect import), no `any`, JSDoc plus explicit return types on exports, import direction between `src/shared/`, `src/browser/` and Node code.
- C# translations: `as const` objects with union types instead of enums; explicit readonly fields assigned in the constructor instead of parameter properties.

## Evidence

- Probe P2 (`docs/evidence/m0/p2-tsc-flags.md`): all 25 positive and negative samples behaved as expected under TypeScript 6.0.3, including rejection of enums, namespaces, parameter properties, angle-bracket casts, extension-less imports, untyped type imports, DOM globals in the Node config and `process` in the browser config.
- Local probe on Node 24.13.0: `process.features.typescript === 'strip'`; `enum` throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- Probe P1: `npm ci --ignore-scripts` of the pinned dependency set takes 8.3 s for 97 MB and 32 packages on the owner's machine, inside Claude Code's 60-second plugin install budget, so dev tooling stays in the root `package.json`.

## Consequences

- The repository must never be consumed through `node_modules` (no npm publishing); distribution is git clone plus `npm ci`.
- Browser-side TypeScript is served stripped by our own server (ADR 0005).
- CI runs Node 24 as the required job and Node 26 as an informational job so stripper drift is seen early.
- TypeScript 7.x is revisited when its compiler API ships.
