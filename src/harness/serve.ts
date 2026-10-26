/**
 * The harness server: a loopback HTTP server, run as its own child process,
 * that serves allowlisted directories to the browser and strips TypeScript
 * to JavaScript on the way (ADR 0005).
 *
 *   node --disable-warning=ExperimentalWarning src/harness/serve.ts --config <path.json>
 *
 * The config is `{ roots: [{ urlPrefix, directory }], port? }`. Once the
 * server listens it prints exactly one line, `{"port":N}`, to standard
 * output and runs until standard input closes or SIGTERM arrives. One line
 * per request (method, path, status, and "(aborted)" when the response did
 * not finish) goes to standard error; request bodies are never read or
 * logged.
 *
 * Entry point only: it runs main() at load and exports nothing, so nothing
 * imports it. The request logic lives in request-handler.ts. This is the
 * only file that imports stripTypeScriptTypes.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { parseArguments } from '../cli/arguments.ts';
import { VisionForgeError, describeError } from '../errors/vision-forge-error.ts';
import { handleRequest, internalErrorText, loopback, readServeConfig, requestPath, sendText } from './request-handler.ts';
import type { StripFunction } from './request-handler.ts';

const strip: StripFunction = (source: string): string => stripTypeScriptTypes(source, { mode: 'strip' });

function logRequest(request: IncomingMessage, response: ServerResponse): void {
  const path = requestPath(request.url) ?? '(unparseable)';
  response.once('close', () => {
    process.stderr.write(`${request.method ?? 'GET'} ${path} ${response.statusCode}${response.writableFinished ? '' : ' (aborted)'}\n`);
  });
}

function fail(error: unknown): never {
  const described = describeError(error);
  process.stderr.write(`${described.message}\n${described.hint}\n`);
  process.exit(described.exitCode);
}

function listenError(port: number, error: NodeJS.ErrnoException): VisionForgeError {
  return new VisionForgeError({
    code: 'harness-server',
    message: `The harness server cannot listen on ${loopback}:${port}: ${error.message}`,
    hint: error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Pass port 0 (the default) to let the operating system pick a free one, or stop the program that holds it.`
      : 'Check that nothing blocks loopback listeners on this machine (a firewall, a sandbox or a policy).',
    cause: error,
  });
}

function listen(server: Server, port: number): void {
  server.on('error', (error: NodeJS.ErrnoException) => { fail(listenError(port, error)); });
  server.listen(port, loopback, () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      fail(new Error('The harness server did not report a port.'));
    }
    process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
  });
}

function runUntilStopped(server: Server): void {
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    server.close(() => { process.exit(0); });
    server.closeAllConnections();
    setTimeout(() => { process.exit(0); }, 1_000).unref();
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('error', shutdown);
  process.stdin.resume();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function main(argv: readonly string[]): void {
  const args = parseArguments(argv, { strings: ['config'], flags: [] });
  const config = readServeConfig(args.requireString('config', 'the JSON file naming the roots to serve'));
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    logRequest(request, response);
    try {
      handleRequest(config.roots, strip, request, response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error serving ${requestPath(request.url) ?? '(unparseable)'}: ${message}\n`);
      if (response.headersSent) {
        response.destroy();
      } else {
        sendText(response, 500, internalErrorText);
      }
    }
  });
  listen(server, config.port ?? 0);
  runUntilStopped(server);
}

try {
  main(process.argv.slice(2));
} catch (error: unknown) {
  fail(error);
}
