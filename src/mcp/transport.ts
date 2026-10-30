/**
 * How messages reach the server and leave it (ADR 0009, decision 1). The
 * stdio transport reads newline-delimited JSON from a readable stream and
 * writes one JSON line per message to a writable stream, and nothing else:
 * standard output belongs to the protocol. A line that does not parse is
 * answered here with the parse or invalid-request error, so the server only
 * ever sees well-formed messages.
 */
import type { Readable, Writable } from 'node:stream';
import { errorResponse, parseMessage, serializeMessage } from './jsonrpc.ts';
import type { JsonRpcMessage } from './types.ts';

/** What the server needs from a connection. */
export interface Transport {
  /** Begins delivering messages; onClose fires once, when the peer goes away or close() is called. */
  start(onMessage: (message: JsonRpcMessage) => void, onClose: () => void): void;
  /** Sends one message; dropped silently once the transport is closed. */
  send(message: JsonRpcMessage): void;
  /** Stops reading and fires onClose if it has not fired yet. */
  close(): void;
}

/** The stdio transport over any readable/writable pair: process.stdin and process.stdout in the entry, PassThrough streams in tests. */
export class StdioTransport implements Transport {
  private readonly input: Readable;
  private readonly output: Writable;
  private buffer = '';
  private closed = false;
  private onClose: (() => void) | undefined;

  constructor(input: Readable, output: Writable) {
    this.input = input;
    this.output = output;
  }

  /**
   * Attaches to the streams; partial chunks are buffered until their newline,
   * CRLF is accepted, blank lines are skipped. When input ends, an
   * unterminated final line is dropped: the framing is newline-delimited, and
   * a client that closes its end mid-line has gone away, so nothing it sent
   * could be answered anyway.
   */
  start(onMessage: (message: JsonRpcMessage) => void, onClose: () => void): void {
    this.onClose = onClose;
    this.input.setEncoding('utf8');
    this.input.on('data', (chunk: string | Buffer) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.drain(onMessage);
    });
    this.input.on('end', () => {
      this.buffer = '';
      this.finish();
    });
    this.input.on('error', () => { this.finish(); });
    this.output.on('error', () => { this.finish(); });
  }

  /** Writes the message as one JSON line. */
  send(message: JsonRpcMessage): void {
    if (this.closed) return;
    this.output.write(`${serializeMessage(message)}\n`);
  }

  /** Stops reading; the output stream is left open for the owner to end. */
  close(): void {
    this.finish();
  }

  private drain(onMessage: (message: JsonRpcMessage) => void): void {
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0 && !this.closed) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.handleLine(line, onMessage);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(raw: string, onMessage: (message: JsonRpcMessage) => void): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim().length === 0) return;
    const outcome = parseMessage(line);
    if (outcome.ok) onMessage(outcome.message);
    else this.send(errorResponse(outcome.id, outcome.error.code, outcome.error.message));
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.input.pause();
    this.onClose?.();
  }
}
