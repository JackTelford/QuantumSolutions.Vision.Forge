/**
 * The MCP server (ADR 0009): takes JSON-RPC messages from a transport,
 * answers the protocol methods from the registry, runs tool calls under a
 * cancellable context and streams their progress back. It knows nothing of
 * stdio, files or commands; scripts/mcp.ts binds it to all three.
 *
 * One AbortController per in-flight request: a cancelled notification or a
 * closed transport aborts it, and a cancelled request gets no response.
 * Tools marked exclusive run one after another through a promise queue;
 * every other tool runs as soon as it is called.
 */
import { failureResult } from '../cli/result.ts';
import { CancelledError, describeError } from '../errors/vision-forge-error.ts';
import type { DescribedError } from '../errors/vision-forge-error.ts';
import { ProtocolError, errorResponse, isNotification, isRecord, isRequest, notification, resultResponse } from './jsonrpc.ts';
import type { Transport } from './transport.ts';
import { JsonRpcErrorCodes, supportedProtocolVersions } from './types.ts';
import type { JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, PromptDefinition, ServerInfo, ServerPaths, ServerRegistry, ToolCallContext, ToolDefinition, ToolResult } from './types.ts';

/** The MCP logging levels, least severe first. */
const logLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'] as const;

type LogLevel = (typeof logLevels)[number];

interface InFlight {
  readonly method: string;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}

/** A tool call's context plus the switch that silences its report() once the call has been answered. */
interface BoundContext {
  readonly context: ToolCallContext;
  readonly finish: () => void;
}

/** The hint a client reads when a tool or handler threw something that is not a VisionForgeError: the server keeps no log file, the entry prints the stack to standard error. */
const unexpectedHint = "This was not expected; the details are on the server's standard error.";

/** What the entry can hook into the server. */
export interface McpServerOptions {
  /** Receives every thrown value that is not a VisionForgeError, before the client is answered; the entry prints its stack to standard error. */
  readonly onUnexpected?: (error: unknown) => void;
}

/** Serves one client over one transport. */
export class McpServer {
  private readonly registry: ServerRegistry;
  private readonly info: ServerInfo;
  private readonly paths: ServerPaths;
  private readonly transport: Transport;
  private readonly onUnexpected: ((error: unknown) => void) | undefined;
  private readonly inFlight = new Map<string, InFlight>();
  private readonly whenClosed: Promise<void>;
  private resolveClosed: (() => void) | undefined;
  private initialized = false;
  private closed = false;
  private logLevel: LogLevel = 'info';
  private exclusiveTail: Promise<void> = Promise.resolve();

  constructor(registry: ServerRegistry, info: ServerInfo, paths: ServerPaths, transport: Transport, options: McpServerOptions = {}) {
    this.registry = registry;
    this.info = info;
    this.paths = paths;
    this.transport = transport;
    this.onUnexpected = options.onUnexpected;
    this.whenClosed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
  }

  /** Starts taking messages; resolves once the transport has closed and every in-flight request has settled. */
  async start(): Promise<void> {
    this.transport.start((message) => { this.receive(message); }, () => { void this.handleClose(); });
    await this.whenClosed;
  }

  /** Closes the transport, which aborts every in-flight request. */
  close(): void {
    this.transport.close();
  }

  private receive(message: JsonRpcMessage): void {
    if (isRequest(message)) this.track(message);
    else if (isNotification(message)) this.handleNotification(message);
  }

  private track(request: JsonRpcRequest): void {
    const key = idKey(request.id);
    const controller = new AbortController();
    const settled = this.answer(request, controller).finally(() => {
      if (this.inFlight.get(key)?.controller === controller) this.inFlight.delete(key);
    });
    this.inFlight.set(key, { method: request.method, controller, settled });
  }

  private async answer(request: JsonRpcRequest, controller: AbortController): Promise<void> {
    try {
      const result = await this.dispatch(request, controller.signal);
      if (!controller.signal.aborted) this.transport.send(resultResponse(request.id, result));
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (error instanceof ProtocolError) this.transport.send(errorResponse(request.id, error.code, error.message, error.data));
      else this.transport.send(errorResponse(request.id, JsonRpcErrorCodes.internalError, this.describe(error).message));
    }
  }

  /** Describes a thrown value for the client; one that was not expected also reaches the entry's hook and gets a hint that is true for the server. */
  private describe(error: unknown): DescribedError {
    const described = describeError(error);
    if (described.code !== 'unexpected') return described;
    this.onUnexpected?.(error);
    return { ...described, hint: unexpectedHint };
  }

  private async dispatch(request: JsonRpcRequest, signal: AbortSignal): Promise<unknown> {
    const { method } = request;
    if (method === 'ping') return {};
    if (method === 'initialize') return this.initialize(request);
    if (!this.initialized) throw new ProtocolError(JsonRpcErrorCodes.invalidRequest, 'Not initialized: send initialize first.');
    switch (method) {
      case 'tools/list': return { tools: this.registry.tools.map(describeTool) };
      case 'tools/call': return this.callTool(request, signal);
      case 'resources/list': return { resources: this.registry.resources.map(({ uri, name, description, mimeType }) => (description === undefined ? { uri, name, mimeType } : { uri, name, description, mimeType })) };
      case 'resources/read': return this.readResource(request);
      case 'prompts/list': return { prompts: this.registry.prompts.map(({ name, description, arguments: args }) => ({ name, description, arguments: args })) };
      case 'prompts/get': return this.getPrompt(request);
      case 'logging/setLevel': return this.setLogLevel(request);
      default: throw new ProtocolError(JsonRpcErrorCodes.methodNotFound, `Method not found: "${method}".`);
    }
  }

  private initialize(request: JsonRpcRequest): unknown {
    const requested = requireString(paramsOf(request), 'protocolVersion');
    const protocolVersion = supportedProtocolVersions.includes(requested) ? requested : supportedProtocolVersions[0] ?? requested;
    this.initialized = true;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, logging: {} },
      serverInfo: this.info,
      instructions: this.registry.instructions,
    };
  }

  private async callTool(request: JsonRpcRequest, signal: AbortSignal): Promise<ToolResult> {
    const params = paramsOf(request);
    const name = requireString(params, 'name');
    const input = optionalRecord(params, 'arguments');
    const token = optionalRecord(params, '_meta')['progressToken'];
    if (token !== undefined && typeof token !== 'string' && typeof token !== 'number') throw invalidParams('_meta.progressToken', 'a string or a number');
    const tool = this.registry.tools.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new ProtocolError(JsonRpcErrorCodes.invalidParams, `Unknown tool "${name}".`, { field: 'name', tools: this.registry.tools.map((candidate) => candidate.name) });
    const { context, finish } = this.contextFor(tool, token, signal);
    const run = (): Promise<ToolResult> => this.runTool(tool, input, context).finally(finish);
    return tool.exclusive === true ? this.runExclusively(run, signal) : run();
  }

  /** Queues the run behind every earlier exclusive run; a call cancelled while it waits never starts. */
  private runExclusively(run: () => Promise<ToolResult>, signal: AbortSignal): Promise<ToolResult> {
    const turn = this.exclusiveTail.then(() => {
      if (signal.aborted) throw new CancelledError();
      return run();
    });
    this.exclusiveTail = turn.then(() => undefined, () => undefined);
    return turn;
  }

  /** Runs the tool; a thrown error becomes a result with isError, carrying the message and hint, never a crash. */
  private async runTool(tool: ToolDefinition, input: Record<string, unknown>, context: ToolCallContext): Promise<ToolResult> {
    try {
      return await tool.run(input, context);
    } catch (error: unknown) {
      const described = this.describe(error);
      return {
        content: [{ type: 'text', text: `${described.message}\n${described.hint}` }],
        structuredContent: { ...failureResult(tool.name, described.exitCode, { code: described.code, message: described.message, hint: described.hint }, described.evidence) },
        isError: true,
      };
    }
  }

  /** Builds the call's context; report() goes quiet once finish() is called, so a child or timer the tool leaves behind cannot report under an answered request. */
  private contextFor(tool: ToolDefinition, token: string | number | undefined, signal: AbortSignal): BoundContext {
    let progress = 0;
    let done = false;
    const finish = (): void => { done = true; };
    const report = (message: string): void => {
      if (done || this.closed || signal.aborted) return;
      if (token !== undefined) {
        progress += 1;
        this.transport.send(notification('notifications/progress', { progressToken: token, progress, message }));
      } else if (this.allows('info')) {
        this.transport.send(notification('notifications/message', { level: 'info', logger: tool.name, data: message }));
      }
    };
    const context: ToolCallContext = { signal, report, dataDir: this.paths.dataDir, outDir: this.paths.outDir, repositoryRoot: this.paths.repositoryRoot };
    return { context, finish };
  }

  private async readResource(request: JsonRpcRequest): Promise<unknown> {
    const uri = requireString(paramsOf(request), 'uri');
    const resource = this.registry.resources.find((candidate) => candidate.uri === uri);
    if (resource === undefined) throw new ProtocolError(JsonRpcErrorCodes.invalidParams, `Unknown resource "${uri}".`, { field: 'uri' });
    return { contents: [{ uri, mimeType: resource.mimeType, text: await resource.read() }] };
  }

  private async getPrompt(request: JsonRpcRequest): Promise<unknown> {
    const params = paramsOf(request);
    const name = requireString(params, 'name');
    const prompt = this.registry.prompts.find((candidate) => candidate.name === name);
    if (prompt === undefined) throw new ProtocolError(JsonRpcErrorCodes.invalidParams, `Unknown prompt "${name}".`, { field: 'name' });
    const args = promptArguments(prompt, optionalRecord(params, 'arguments'));
    return { description: prompt.description, messages: await prompt.get(args) };
  }

  private setLogLevel(request: JsonRpcRequest): unknown {
    const level = requireString(paramsOf(request), 'level');
    if (!isLogLevel(level)) throw invalidParams('level', `one of ${logLevels.join(', ')}`);
    this.logLevel = level;
    return {};
  }

  private allows(level: LogLevel): boolean {
    return logLevels.indexOf(level) >= logLevels.indexOf(this.logLevel);
  }

  private handleNotification(message: JsonRpcNotification): void {
    if (message.method !== 'notifications/cancelled') return;
    const requestId = isRecord(message.params) ? message.params['requestId'] : undefined;
    if (typeof requestId !== 'string' && typeof requestId !== 'number') return;
    const entry = this.inFlight.get(idKey(requestId));
    if (entry !== undefined && entry.method !== 'initialize') entry.controller.abort();
  }

  private async handleClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.inFlight.values()];
    for (const entry of entries) entry.controller.abort();
    await Promise.allSettled(entries.map((entry) => entry.settled));
    this.resolveClosed?.();
  }
}

function idKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function describeTool(tool: ToolDefinition): Record<string, unknown> {
  const { name, description, inputSchema, annotations } = tool;
  return annotations === undefined ? { name, description, inputSchema } : { name, description, inputSchema, annotations };
}

function invalidParams(field: string, expected: string): ProtocolError {
  return new ProtocolError(JsonRpcErrorCodes.invalidParams, `Invalid params: "${field}" must be ${expected}.`, { field });
}

function paramsOf(request: JsonRpcRequest): Record<string, unknown> {
  if (request.params === undefined) return {};
  if (!isRecord(request.params)) throw invalidParams('params', 'an object');
  return request.params;
}

function requireString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string') throw invalidParams(field, 'a string');
  return value;
}

function optionalRecord(params: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = params[field];
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalidParams(field, 'an object');
  return value;
}

function promptArguments(prompt: PromptDefinition, given: Record<string, unknown>): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(given)) {
    if (typeof value !== 'string') throw invalidParams(`arguments.${key}`, 'a string');
    args[key] = value;
  }
  for (const argument of prompt.arguments) {
    if (argument.required && args[argument.name] === undefined) throw invalidParams(`arguments.${argument.name}`, `given (${argument.description})`);
  }
  return args;
}

function isLogLevel(value: string): value is LogLevel {
  return (logLevels as readonly string[]).includes(value);
}
