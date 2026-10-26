# P1: dependency install time and size

Measured 2026-10-26 on the owner's machine (Windows 11, Node v24.13.0, npm 11.6.2), in Git Bash from the repository root, with Windows Defender real-time protection on.

## Commands

```bash
npm install --ignore-scripts --no-audit --no-fund      # creates package-lock.json (lockfileVersion 3)
rm -rf node_modules
time npm ci --ignore-scripts --no-audit --no-fund       # the install Claude Code performs for a plugin
du -sm node_modules
```

## Numbers

| Measure | Value |
| --- | --- |
| `npm install` (first, with network) | 13 s |
| `npm ci --ignore-scripts` from a clean `node_modules` | 8.3 s (8253 ms wall) |
| packages in the lockfile | 32 |
| top-level directories in `node_modules` | 25 |
| `node_modules` size | 97 MB |
| lockfile version | 3 |

Dependencies: `ajv` 8.20.0, `playwright-core` 1.64.1, `three` 0.186.1; dev: `@types/node` 24.19.2, `@types/three` 0.186.0, `json-schema-to-typescript` 16.0.0, `typescript` 6.0.3.

## Decision

Claude Code's plugin install budget is 60 seconds for one all-or-nothing `npm ci --ignore-scripts`. At 8.3 s with dev tooling included, the root `package.json` keeps the dev dependencies; no separate `tools/package.json` is needed. The narration component is excluded from this set by design (ADR 0007).

## Not verified

- Install time on a slow connection or a machine without a warm npm cache; the 13 s `npm install` figure includes network time on the owner's connection only.
