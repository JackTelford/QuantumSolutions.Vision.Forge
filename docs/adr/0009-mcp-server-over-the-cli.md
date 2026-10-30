# ADR 0009: An MCP server over the command-line program, written by hand

Status: accepted, 2026-10-30.

## Context

Until v0.1.0 the studio could be driven from one place: Claude Code, through the `cinematic-studio` skill, whose only program is `node scripts/cli.ts`. The owner wants other AI applications (Claude Desktop, Cursor, Codex, Gemini CLI, Copilot, ChatGPT's desktop connectors) to drive the same studio on the same PC. Every one of them speaks the Model Context Protocol (MCP), a JSON-RPC 2.0 protocol over standard input and output for a locally launched server (the "stdio transport"), with three things a server can offer: tools the model calls, resources it reads and prompts it expands.

The command line already has the shape MCP wants: one command per operation, options with a fixed vocabulary, one JSON result document with `ok`, `data`, `artifacts`, `evidence` and `errors`, exit codes, and progress on standard error. The knowledge base under `skills/cinematic-studio/references/` and the flow in SKILL.md are the directing instructions; they are text.

Constraints that bind here: no dependency without approval (the approved list is in `package.json`), TypeScript on Node's type stripping with erasable syntax only, nothing spawns `npx` or `npm`, nothing reads `CLAUDE_PLUGIN_*` from the environment, and the server runs as the user on the user's PC, so what a model can reach through it is bounded.

## Decision

1. **One server, `node scripts/mcp.ts --data-dir <dir> --out <dir>`, over stdio.** The client launches it; standard output carries protocol messages only (newline-delimited JSON-RPC, as the stdio transport specifies), standard error carries diagnostics. The defaults are the platform data directory and `VisionForge/out` under the user's home, since a client's working directory is not the user's. The server is a second entry point beside `scripts/cli.ts`; nothing else in the repository changes shape.

2. **The protocol is written by hand** in `src/mcp/` (about 600 lines over several files) rather than taken from the reference SDK. The surface this server needs is small and stable: `initialize` with version negotiation (2025-06-18, 2025-03-26, 2024-11-05), `ping`, `tools/list` and `tools/call`, `resources/list` and `resources/read`, `prompts/list` and `prompts/get`, `logging/setLevel`, the `progress`, `message` and `cancelled` notifications. The SDK would add a dependency tree (zod and others) to a repository whose rule is to ask before every dependency, and the owner reads every line; a few hundred lines of plain TypeScript are easier to review than a dependency's behaviour. If the surface grows (sampling, elicitation, the HTTP transport), this decision is revisited.

3. **Every tool is a command.** `src/cli/run.ts` runs a command in-process from an argv, so a tool call and a command line do exactly the same thing. The tools: `doctor`, `validate`, `plan`, `still`, `approve_still`, `render`, `task_status`, `task_cancel`, `assemble`, `qa`, `sheet`, `assets`, `audio_install`, `audio_status`, `audio_voices`, `audio_synth`. Each tool's input schema mirrors its command's options in camelCase, and its result is the command's result document as JSON text (and as `structuredContent`), `isError` when `ok` is false, so a model reads the same `errors[].hint` a Claude Code session reads.

4. **Documents can be passed inline.** Not every client can write files, so `plan`, `validate` and `audio_synth` accept the documents (or the script) as JSON or text in the call as well as by path; inline documents are written under `<out>/documents/<content hash>/` and planned from there, which keeps the job id the hash of the same four documents.

5. **Stills and sheets come back as images.** `still` returns the finished still (and the text plate's composite) and `sheet` returns the contact sheet as `image/png` content beside the JSON, so the model looks at the frame as the still loop demands. An image over 4 MB encoded is replaced by its path and a sentence, since clients cap message size.

6. **Long work runs as a task.** A render can take minutes and most clients time out a tool call near a minute, so `render` (and, on request, any tool, with `background: true`) returns a task id at once; `task_status` returns the progress lines and, when done, the result; `task_cancel` aborts it, and a cancelled render resumes on the next call like a cancelled command. When the request carries a `progressToken`, progress lines are also sent as `notifications/progress`. Tools that render or encode (`still`, `render`, `assemble`, `qa`, `sheet`, `audio_synth`) run one at a time, since the browser profile and Blender cannot be shared; `audio_install` joins them, since it writes the packages and weights `audio_synth` loads into the data directory; the others run concurrently.

7. **Paths a tool reads are confined** to the output directory, the data directory, the repository (for the shipped examples) and the user's home directory; anything else is refused with the directory to use. The server never reads a path a resource names outside the repository's `skills/`, `schemas/` and `docs/` folders.

8. **The knowledge base is served as resources** under `vision-forge://references/<path>` (every file of `skills/cinematic-studio/references/`), `vision-forge://schemas/<name>` (the JSON Schemas), `vision-forge://examples/<name>/<file>` (the shipped examples) and `vision-forge://skill` (SKILL.md with its placeholders resolved to the server's own paths), read from disk on each request.

9. **The directing flow is a prompt and the initialize instructions.** The prompt `cinematic-studio` takes the user's brief and expands to the eleven-step flow of SKILL.md phrased for the tools (questionnaire, treatment gate, shot list, look, `doctor`, `assets`, `plan`, the still loop with three named faults, `approve_still`, the render estimate and the yes before a long render, narration before durations lock, `assemble` then `qa`, what to tell the user), followed by the brief. The `instructions` field of `initialize` carries the same flow in short, so a client that uses tools only still follows it.

10. **The skill stays.** Claude Code keeps the skill as its route (the skill carries the plugin's data directory and project directory, which the MCP server cannot know); the MCP server is the route for every other client, and both run the same commands.

## Consequences

- Any MCP client on the same PC can drive a production, with the same gates refusing the same frames; how well it directs depends on how well its model follows the prompt.
- No new dependency. The protocol code is tested with a fake client in-process and over a real stdio spawn, and the tests assert that standard output carries nothing but JSON lines.
- Rendering stays local. A hosted server for browser-only clients would need the streamable HTTP transport and a machine with ffmpeg, a browser, a GPU and optionally Blender; that is a separate decision.
- `src/cli/run.ts` is the one place a command is run from an argv; `scripts/cli.ts` is now a thin shell around it.
