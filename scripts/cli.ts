/**
 * The one program the skill calls: `node scripts/cli.ts <command> [options]`.
 *
 * Standard output carries exactly one JSON result document; progress and
 * errors go to standard error. Exit codes: 0 success, 1 failure, 2 usage,
 * 130 cancelled. Errors print their message and hint, never a stack trace.
 * The command itself runs through src/cli/run.ts, which the MCP server
 * shares (scripts/mcp.ts).
 */
import { exitCodeOf, runCommand } from '../src/cli/run.ts';
import { serializeResult } from '../src/cli/result.ts';
import { ExitCodes } from '../src/errors/vision-forge-error.ts';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const pretty = argv.includes('--pretty');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const result = await runCommand(argv, {
    signal: controller.signal,
    onError: (described, error) => {
      process.stderr.write(`error: ${described.message}\n${described.hint}\n`);
      if (described.code === 'unexpected' && error instanceof Error && error.stack !== undefined) {
        process.stderr.write(`${error.stack}\n`);
      }
    },
  });
  process.stdout.write(serializeResult(result, pretty));
  return exitCodeOf(result);
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = ExitCodes.failure;
  },
);
