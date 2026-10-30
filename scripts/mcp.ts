/**
 * The MCP entry (ADR 0009): `node scripts/mcp.ts [--data-dir <dir>] [--out <dir>]`.
 *
 * An MCP client launches it and speaks newline-delimited JSON-RPC on its
 * standard input and output; standard output carries protocol messages
 * only, so every diagnostic goes to standard error. The defaults are the
 * platform data directory and VisionForge/out under the user's home, since
 * a client's working directory is not the user's. The process exits 0 when
 * standard input ends and every in-flight request has settled.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/cli/arguments.ts';
import { ExitCodes, UsageError, describeError } from '../src/errors/vision-forge-error.ts';
import { resolveDataDir } from '../src/fs/paths.ts';
import { isRecord } from '../src/mcp/jsonrpc.ts';
import { createRegistry } from '../src/mcp/registry.ts';
import { McpServer } from '../src/mcp/server.ts';
import { StdioTransport } from '../src/mcp/transport.ts';
import type { ServerInfo, ServerPaths } from '../src/mcp/types.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  const version = isRecord(parsed) ? parsed['version'] : undefined;
  return typeof version === 'string' ? version : '0.0.0';
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2), { strings: ['data-dir', 'out'], flags: [] });
  if (args.positionals.length > 0) {
    throw new UsageError(`Unexpected argument "${args.positionals[0] ?? ''}".`, 'Usage: node scripts/mcp.ts [--data-dir <dir>] [--out <dir>]. The server takes no command; clients call tools.');
  }
  const dataDir = resolveDataDir(args.string('data-dir'));
  const out = args.string('out');
  const outDir = out !== undefined && out.length > 0 ? resolve(out) : join(homedir(), 'VisionForge', 'out');
  mkdirSync(outDir, { recursive: true });
  const paths: ServerPaths = { dataDir, outDir, repositoryRoot };
  const info: ServerInfo = { name: 'vision-forge', title: 'Vision.Forge cinematic studio', version: packageVersion() };
  const server = new McpServer(createRegistry(paths), info, paths, new StdioTransport(process.stdin, process.stdout), {
    // The server keeps no log file; like scripts/cli.ts, an unexpected throw leaves its stack on standard error, never on standard output.
    onUnexpected: (error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); },
  });
  process.stderr.write(`vision-forge mcp ${info.version} on stdio; data ${dataDir}; out ${outDir}\n`);
  await server.start();
  return ExitCodes.success;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    const described = describeError(error);
    process.stderr.write(`error: ${described.message}\n${described.hint}\n`);
    process.exitCode = described.exitCode;
  },
);
