/**
 * JSON-RPC 2.0 framing for the MCP server (ADR 0009, decision 2): one line
 * of text in, one message or one error out; a message back to one line.
 * Nothing here knows an MCP method; server.ts gives the messages meaning.
 */
import { JsonRpcErrorCodes } from './types.ts';
import type { JsonRpcError, JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './types.ts';

/** A line that parsed as a message. */
export interface ParseSuccess {
  readonly ok: true;
  readonly message: JsonRpcMessage;
}

/** A line that did not parse as a message: the error to answer with and the id to answer on (null when the line carried none). */
export interface ParseFailure {
  readonly ok: false;
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcError;
}

/** What parseMessage returns. */
export type ParseOutcome = ParseSuccess | ParseFailure;

/** Thrown by a request handler to answer with a JSON-RPC error of the given code instead of a result. */
export class ProtocolError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.data = data;
  }
}

/** Parses one line into a request, notification or response; a malformed line yields the parse or invalid-request error to send back. */
export function parseMessage(line: string): ParseOutcome {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error: unknown) {
    return failure(null, JsonRpcErrorCodes.parseError, `Parse error: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (Array.isArray(value)) return failure(null, JsonRpcErrorCodes.invalidRequest, 'Invalid request: batches are not supported; send one message per line.');
  if (!isRecord(value)) return failure(null, JsonRpcErrorCodes.invalidRequest, 'Invalid request: a message is a JSON object.');
  const id = value['id'];
  const knownId = isId(id) ? id : null;
  if (value['jsonrpc'] !== '2.0') return failure(knownId, JsonRpcErrorCodes.invalidRequest, 'Invalid request: "jsonrpc" must be "2.0".');
  const method = value['method'];
  if (method !== undefined) {
    if (typeof method !== 'string') return failure(knownId, JsonRpcErrorCodes.invalidRequest, 'Invalid request: "method" must be a string.');
    const params = value['params'];
    if (id === undefined) return { ok: true, message: params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params } };
    if (!isId(id)) return failure(null, JsonRpcErrorCodes.invalidRequest, 'Invalid request: "id" must be a string or a number.');
    return { ok: true, message: params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params } };
  }
  if ('result' in value || 'error' in value) {
    if (id !== null && !isId(id)) return failure(null, JsonRpcErrorCodes.invalidRequest, 'Invalid request: a response "id" must be a string, a number or null.');
    const error = value['error'];
    if (error !== undefined && !isErrorObject(error)) return failure(knownId, JsonRpcErrorCodes.invalidRequest, 'Invalid request: "error" must carry a numeric code and a string message.');
    return { ok: true, message: error === undefined ? { jsonrpc: '2.0', id, result: value['result'] } : { jsonrpc: '2.0', id, error } };
  }
  return failure(knownId, JsonRpcErrorCodes.invalidRequest, 'Invalid request: a message carries a "method" or a "result" or "error".');
}

/** True for a request: a method with an id. */
export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

/** True for a notification: a method without an id. */
export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

/** True for a response: a result or an error, no method. */
export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return !('method' in message);
}

/** One line of JSON for the wire, without the newline; JSON.stringify never emits a raw line break. */
export function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

/** A response carrying a result. */
export function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** A response carrying an error; data travels only when given. */
export function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** A notification from the server to the client. */
export function notification(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isErrorObject(value: unknown): value is JsonRpcError {
  return isRecord(value) && typeof value['code'] === 'number' && typeof value['message'] === 'string';
}

function failure(id: JsonRpcId | null, code: number, message: string): ParseFailure {
  return { ok: false, id, error: { code, message } };
}
