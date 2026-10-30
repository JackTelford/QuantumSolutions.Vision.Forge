import type { JsonRpcId, JsonRpcResponse } from '../../src/mcp/types.ts';

/** Collects newline-delimited output as it arrives (CRLF accepted) and lets a test wait for a response by id. */
export class LineReader {
  readonly lines: string[] = [];
  private buffer = '';

  /** Appends a chunk and splits off every complete line. */
  feed(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      this.lines.push(this.buffer.slice(0, newline).replace(/\r$/, ''));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** Every line parsed as a message; a line that is not JSON fails with that line in the message, since a polluted stream is the defect the reader exists to catch. */
  messages(): JsonRpcResponse[] {
    return this.lines.map((line) => {
      try {
        return JSON.parse(line) as JsonRpcResponse;
      } catch {
        throw new Error(`stdout carried a line that is not JSON: ${line}`);
      }
    });
  }

  /** True once a response with this id has been written. */
  has(id: JsonRpcId): boolean {
    return this.messages().some((message) => message.id === id);
  }

  /** Waits for the response with this id. */
  async response(id: JsonRpcId, timeoutMs = 30_000): Promise<JsonRpcResponse> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages().find((message) => message.id === id);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`No response with id ${String(id)} within ${timeoutMs} ms; stdout so far: ${this.lines.join(' | ')}`);
      await new Promise<void>((done) => setTimeout(done, 10));
    }
  }
}
