/**
 * The contracts of the MCP server (ADR 0009): the JSON-RPC messages it
 * exchanges over stdio, and the three registries it serves (tools,
 * resources, prompts). Every other file under src/mcp/ builds on these
 * types; none of them is generated. Shapes follow the Model Context
 * Protocol specification (2025-06-18), restricted to what this server uses.
 */

/** A JSON-RPC 2.0 request id. */
export type JsonRpcId = string | number;

/** A JSON-RPC 2.0 request: has an id and a method. */
export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** A JSON-RPC 2.0 notification: a method without an id; never answered. */
export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

/** A JSON-RPC 2.0 error object. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A JSON-RPC 2.0 response: exactly one of result or error. */
export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/** Anything that travels on the wire. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** The JSON-RPC error codes this server emits. */
export const JsonRpcErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** The protocol versions this server accepts, newest first; the first is what it offers when the client asks for one it does not know. */
export const supportedProtocolVersions: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** One piece of content in a tool result. */
export type ToolContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: 'image/png' | 'image/jpeg' };

/** What a tool call returns to the client. */
export interface ToolResult {
  readonly content: readonly ToolContent[];
  /** The same payload as data, for clients that read structured output: always the CLI result document for command tools. */
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

/** Hints clients show beside a tool. */
export interface ToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** A JSON Schema object for a tool's input: always `type: object` with named properties. */
export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/** What every tool call can reach while it runs. */
export interface ToolCallContext {
  /** Aborted when the client cancels the request or the connection closes. */
  readonly signal: AbortSignal;
  /** Sends one line of progress to the client (a progress notification when the request carried a progress token, else a log message). */
  readonly report: (message: string) => void;
  /** Where caches, the tool record and components live; the server's --data-dir. */
  readonly dataDir: string;
  /** Where deliverables go; the server's --out. */
  readonly outDir: string;
  /** The repository root, where the skill, its references and examples are. */
  readonly repositoryRoot: string;
}

/** A tool the server offers. */
export interface ToolDefinition {
  /** The name a client calls: lowercase letters, digits and underscores, unique. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly annotations?: ToolAnnotations;
  /** True for a tool that renders or encodes: such calls run one at a time, since the browser profile and Blender cannot be shared. */
  readonly exclusive?: boolean;
  run(input: Record<string, unknown>, context: ToolCallContext): Promise<ToolResult>;
}

/** A resource the server offers: a file of the knowledge base, a schema or an example. */
export interface ResourceDefinition {
  /** `vision-forge://<kind>/<path>`. */
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType: string;
  /** Reads the resource's text; the file is read on each call so edits show without a restart. */
  read(): Promise<string>;
}

/** One argument a prompt takes. */
export interface PromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

/** One message a prompt expands to. */
export interface PromptMessage {
  readonly role: 'user' | 'assistant';
  readonly content: { readonly type: 'text'; readonly text: string };
}

/** A prompt the server offers: a named, parameterised instruction the client's model follows. */
export interface PromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
  get(args: Readonly<Record<string, string>>): Promise<readonly PromptMessage[]>;
}

/** What the server is built from. */
export interface ServerRegistry {
  readonly tools: readonly ToolDefinition[];
  readonly resources: readonly ResourceDefinition[];
  readonly prompts: readonly PromptDefinition[];
  /** The paragraph the client's model reads at initialize: what the server is, the flow to follow, where files land. */
  readonly instructions: string;
}

/** The server's identity as sent at initialize. */
export interface ServerInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

/** The directories and roots a server instance is bound to. */
export interface ServerPaths {
  readonly dataDir: string;
  readonly outDir: string;
  readonly repositoryRoot: string;
}
