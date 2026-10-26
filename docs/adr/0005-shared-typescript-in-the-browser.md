# ADR 0005: Shared TypeScript reaches the browser through Node's stripper and an import map

Status: accepted, 2026-10-26.

## Context

The browser lanes need the shared camera, easing and timeline modules, written once in TypeScript under `src/shared/`. Options:

1. **Strip on serve**: a tiny `node:http` server runs `module.stripTypeScriptTypes` on `.ts` requests and serves the result as `text/javascript`; bare `three` imports are resolved by a browser import map.
2. **Bundler** (esbuild, MIT): a build step and a native binary per platform; accepts syntax (enums, namespaces) that Node rejects, so browser and Node code would follow different rules.
3. **Plain JavaScript** for browser code: loses type checking of the lane code the owner reviews.

Facts: `stripTypeScriptTypes` erases `import type` lines to whitespace (line and column numbers preserved) and keeps `./x.ts` specifiers; the API is "release candidate" and still prints an `ExperimentalWarning` on Node 24.13 and 26.12 (`--disable-warning=ExperimentalWarning` silences it); its `transform` mode was removed in Node 26. `three@0.186.1`'s `build/three.module.js` imports `./three.core.js`, and every addon imports the bare specifier `three`, so the whole package directory must be served and an import map is mandatory. Generic static servers map `.ts` to `video/mp2t`, which module scripts refuse. Module scripts from `file://` are blocked by CORS.

## Decision

Option 1.

- `src/harness/serve.ts` is the only file that imports `stripTypeScriptTypes`. It runs as its own child process started with `--disable-warning=ExperimentalWarning`, listens on `127.0.0.1:0`, prints `{port}` once, serves `.ts` stripped as `text/javascript` with `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, answers `/favicon.ico` with 204, serves only allowlisted roots (runtime, lane, job page, `/vendor/three/` mapped to `node_modules/three` resolved from `import.meta.dirname`, `/fonts/`, `/assets/`) and refuses any path that escapes a root.
- Pages carry an import map: `three` → `/vendor/three/build/three.module.js`, `three/addons/` and `three/examples/jsm/` → `/vendor/three/examples/jsm/`.
- Type checking uses the two configurations from ADR 0001; `@types/three` 0.186.0 (dev, MIT, owner-approved) types the browser lane.
- Fallback if the Node API drifts: pin `amaro` (MIT, the stripper Node wraps) in that one file.

## Evidence

Probe P3 (`docs/evidence/m0/p3-tsserve.md`): on both Edge 156 and Chrome 156 a page loaded `shared/timing.ts` and `app/main.ts` stripped on the fly, imported `REVISION` from `three` and `EffectComposer` and `SSAARenderPass` from `three/addons/` through the import map, and set `document.title` to `OK 1 r186 function function` in about 110 ms. Path traversal returned 404. `file://` loading was blocked by CORS with the exact Chromium message recorded. A decorator served the same way failed with `SyntaxError: Invalid or unexpected token`, loudly.

## Consequences

- No bundler, no extra dependency, no source maps needed; the reviewer reads exactly the code that runs.
- One syntax rule set for Node and browser code, enforced by `erasableSyntaxOnly` and the stripper alike.
- Decorators and inline type specifiers pass `tsc`; `scripts/lint.ts` rejects them (M0b).
