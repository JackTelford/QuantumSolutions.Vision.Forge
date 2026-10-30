# Evidence: M9, the MCP server (2026-10-30)

The server of ADR 0009 driven end to end by a hand-written stdio client (`node` spawning `scripts/mcp.ts`, newline JSON-RPC on its pipes), on the owner's machine (Windows 11, Node v24.13.0, Edge 156, ffmpeg 9.0.2), against the explainer's four documents passed inline. The client is not committed (a throw-away probe); the digest it printed is below, verbatim where it matters.

## The run

| Step | What was sent | What came back |
| --- | --- | --- |
| initialize (2025-06-18) | capabilities {}, clientInfo probe | protocolVersion 2025-06-18; capabilities tools, resources, prompts, logging; serverInfo vision-forge 0.1.0; instructions 3,359 characters |
| ping | | `{}` |
| tools/list | | 16 tools in production order: doctor validate plan still approve_still render assemble qa sheet assets audio_install audio_status audio_voices audio_synth task_status task_cancel |
| resources/list | | 39 resources: every file under `references/`, the schemas, both examples, `vision-forge://skill` |
| resources/read skill | | 27,584 characters, frontmatter gone, no `${CLAUDE_` placeholder left |
| prompts/list, prompts/get cinematic-studio | brief: a 10-second title card | one user message of 11,694 characters ending with the brief |
| tools/call doctor | skipBrowserCheck, skipBlenderProbe | ok true, the tools manifest as data, structuredContent present |
| tools/call validate | an inline brief missing its fields | isError true, code `schema-validation`, the schema named in the hint |
| tools/call plan | the explainer's four documents inline | ok true, job `62fedd4e` under `<out>/62fedd4e`: the same id the CLI gives the same documents on disk |
| tools/call still s01 with a progressToken | | ok true, gate passed, one `image/png` content of 262,260 base64 characters, 85 `notifications/progress` |
| tools/call still with job `C:/Windows/System32` | | isError true, code `path-not-allowed`, the hint lists the four allowed roots |
| tools/call render s01 (allowUnapproved) | | at once: `{taskId, tool: render, status: running, startedAt, hint}` as text and structuredContent |
| tools/call task_status | the task id | status `done` after one poll, lines `["s01  html  140 frames already rendered; reused"]`, result = the render's CLI document (ok true, 140 frames reused from the cache) |
| tools/call task_cancel on the finished task | | the task document, status still `done` |
| tools/call nope | | JSON-RPC error −32602 "Unknown tool", data lists the tools |
| nope/x | | JSON-RPC error −32601 |
| close stdin | | exit code 0; every stdout line parsed as JSON (0 non-JSON lines); stderr's first line `vision-forge mcp 0.1.0 on stdio; data …; out …` |

108 notifications were received in all (`notifications/message` for progress without a token, `notifications/progress` with one).

## The suite

`node --test "tests/mcp/*.test.ts"`: 114 tests, 0 failures (the protocol core with a fake transport and a spawned server, the tools' argv tables, the path policy, inline documents, the task table, the sheet tool's image, the resources and the prompt). `npm run check`: see the handoff's M9 evidence row.

## Not verified

- A real client (Claude Desktop, Cursor, Codex, Gemini CLI) connected to the server: the configs in `docs/SETUP.md` follow each client's documentation and were not exercised here (`claude -p` fails on the CLI's own sign-in from inside a session, as M8 records). The owner's test guide names the Claude Desktop check as the first thing to run.
- The server on macOS and Linux beyond the ubuntu CI runner's tests.
- A client that sends a request larger than one line of several megabytes (inline documents are kilobytes).
