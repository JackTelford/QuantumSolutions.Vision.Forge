/**
 * Human-readable progress goes to standard error so that standard output can
 * carry exactly one JSON result (see result.ts).
 */

/** Log levels in increasing verbosity. */
export const LogLevels = { quiet: 0, normal: 1, verbose: 2 } as const;

/** One of the values in LogLevels. */
export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

/** What commands use to report progress. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

/** A logger that writes to a text stream (standard error by default). */
export class StreamLogger implements Logger {
  private readonly level: LogLevel;
  private readonly write: (text: string) => void;

  constructor(level: LogLevel, write: (text: string) => void = (text) => { process.stderr.write(text); }) {
    this.level = level;
    this.write = write;
  }

  /** Normal progress. */
  info(message: string): void {
    if (this.level >= LogLevels.normal) this.write(`${message}\n`);
  }

  /** Something worth attention that did not stop the command. */
  warn(message: string): void {
    if (this.level >= LogLevels.normal) this.write(`warning: ${message}\n`);
  }

  /** Detail shown only with --verbose. */
  debug(message: string): void {
    if (this.level >= LogLevels.verbose) this.write(`debug: ${message}\n`);
  }
}

/** A logger that records messages, for tests. */
export class MemoryLogger implements Logger {
  readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(`info: ${message}`);
  }

  warn(message: string): void {
    this.messages.push(`warn: ${message}`);
  }

  debug(message: string): void {
    this.messages.push(`debug: ${message}`);
  }
}
