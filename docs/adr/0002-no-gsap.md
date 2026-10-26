# ADR 0002: No GSAP, no tool that bundles it

Status: accepted, 2026-10-26.

## Context

GSAP 3.x is distributed under the "Standard 'no charge' license" (2025). Its prohibited-use clause covers tools that let users build visual animations without writing code. ScanCode's license database classifies it as "Proprietary Free", not open source ([ScanCode entry](https://scancode-licensedb.aboutcode.org/gsap-standard-no-charge-2025.html); the npm `license` field of `gsap` says the same). This skill arguably is such a tool, and the owner's constraint is to avoid the question entirely.

HyperFrames (Apache-2.0) uses GSAP as its default animation adapter and loads it from a CDN ([repository](https://github.com/heygen-com/hyperframes)). None of the libraries evaluated for this repository bundle GSAP at runtime; HyperFrames was the only one that depends on it by default.

## Decision

- Animation is expressed as a pure function of the frame number in our own TypeScript timeline (`interpolate`, one canonical `spring`, `sequence`, `stagger`, `delay`, `loop`, named time events) with our own easing table (CSS keywords, Material 3 tokens, sine drifts).
- In the browser lanes, templates set inline styles, transforms and uniforms per frame; CSS animations and the Web Animations API are tolerated only as a guarded fallback that the harness pauses and seeks (ADR 0006).
- `gsap` and any package that depends on it are rejected by the license allowlist check (`scripts/licenses.ts`, M0b).

## Consequences

- No third-party animation runtime: fewer dependencies, one mental model across html, three and Blender.
- Spring and easing math is implemented and unit-tested in-house (M2).
