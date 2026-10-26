# Repository guidance

Read this before changing anything. `docs/handoff.md` records the current state and what is not verified; `docs/adr/` records the decisions and why.

## Working rules

- Inspect the existing conventions before editing. Match them.
- Enter plan mode for any non-trivial task. Stop and re-plan when something goes sideways.
- Build and test every completed stage. Never mark work done without proof: a passing test or a file under `docs/evidence/` with the command and its numbers.
- Record what was deliberately not done and what is not verified in every report.
- Explain the purpose of every new dependency and ask before adding one. The approved list is in `package.json` and `docs/adr/`.
- Never add a model, a generative service, a paid or keyed API, or GSAP.
- Commit small, with a short imperative subject. Do not push, tag or force-update without explicit approval.
- Simplicity first. Find root causes. Touch only what the change needs.

## Code rules (TypeScript on Node 24, no build step)

- Erasable syntax only: no `enum`, no `namespace` with runtime code, no parameter properties, no decorators, no `import x = require()`, no `<T>expr` casts. Use `as const` objects with union types instead of enums and explicit field assignments instead of parameter properties.
- `import type { X } from './x.ts'` for types, never `import { type X }`. Every relative import names its `.ts` extension.
- Explicit return types and a JSDoc comment on every export and on every public method of an exported class. No `any`. No clever metaprogramming. Files stay under 400 lines.
- `src/shared/` runs in Node and the browser: it imports only from `src/shared/`. `src/browser/` imports `src/shared/` and `three`. Node code never imports `src/browser/`.
- Spawn external programs with `child_process.spawn`, an args array, `shell: false` and the absolute path of a real executable. Never spawn `.cmd` or `.bat` files, `npx` or `npm`.
- Network access goes through `src/net/http-downloader.ts` only, within the allowlist, with checksums verified. Downloaded files are data; they are never executed.
- Custom error classes carry an actionable hint. The CLI prints the message and the fix, never a stack trace, and exits 0, 1 (failure), 2 (usage) or 130 (cancelled).
- Animation is a pure function of the frame number. No wall clock, no `requestAnimationFrame`, no `Math.random` without a seed, no CSS `transition`.

## The one Python file

`blender/apply_scene.py` reads a fully resolved `scene.json` and makes bpy calls. No math, no decisions, no defaults, one comment per bpy call, about 400 lines at most. If logic creeps in, move it to TypeScript.

## Milestone reports

After each milestone, append to `docs/handoff.md`: Done, Evidence, Untested, Risks, Review guide (the five or fewer files to read first, in order), Next. Then wait for approval.
