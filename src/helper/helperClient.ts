import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';

import type { DetectorResult } from '../display/types';

export interface HelperClient {
  getCurrentWindowDisplay(): Promise<DetectorResult>;
  dispose?(): void;
}

export interface HelperClientOptions {
  pid?: number;
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
  getTitleHint?: () => string | undefined;
}

export type HelperErrorCode =
  | 'helper_error'
  | 'helper_timeout'
  | 'helper_process_error'
  | 'helper_protocol_error'
  | 'native_helper_error';

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

interface HelperRequest {
  op: 'getCurrentWindowDisplay';
  pid: number;
  titleHint?: string;
}

const defaultTimeoutMs = 1500;
const minTimeoutMs = 200;
const maxTimeoutMs = 5000;

export class HelperClientError extends Error {
  public readonly code: HelperErrorCode;

  public constructor(code: HelperErrorCode, message: string) {
    super(message);
    this.name = 'HelperClientError';
    this.code = code;
  }
}

export class HelperTimeoutError extends HelperClientError {
  public constructor(timeoutMs: number) {
    super('helper_timeout', `Native helper timed out after ${timeoutMs} ms.`);
    this.name = 'HelperTimeoutError';
  }
}

export class HelperProcessError extends HelperClientError {
  public readonly exitCode: number | null;
  public readonly signal: NodeJS.Signals | null;
  public readonly stderr: string;

  public constructor(exitCode: number | null, signal: NodeJS.Signals | null, stderr: string) {
    super('helper_process_error', `Native helper exited unsuccessfully: ${formatExit(exitCode, signal)}.`);
    this.name = 'HelperProcessError';
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderr = stderr;
  }
}

export class HelperProtocolError extends HelperClientError {
  public constructor(message: string) {
    super('helper_protocol_error', message);
    this.name = 'HelperProtocolError';
  }
}

export class NativeHelperError extends HelperClientError {
  public readonly nativeError: string;

  public constructor(nativeError: string) {
    super('native_helper_error', `Native helper returned an error: ${nativeError}.`);
    this.name = 'NativeHelperError';
    this.nativeError = nativeError;
  }
}

/**
 * Keeps one helper process alive and speaks JSON-lines over stdin/stdout.
 * Spawning once avoids the cost of launching a native process every poll.
 */
export class JsonLineHelperClient implements HelperClient {
  private readonly helperPath: string;
  private readonly pid: number;
  private readonly timeoutMs: number;
  private readonly spawnProcess: SpawnProcess;
  private readonly getTitleHint?: () => string | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private queue: Promise<void> = Promise.resolve();
  private pending:
    | {
        resolve: (value: DetectorResult) => void;
        reject: (error: unknown) => void;
        timeout: NodeJS.Timeout;
      }
    | undefined;
  private disposed = false;

  public constructor(helperPath: string, options: HelperClientOptions = {}) {
    this.helperPath = helperPath;
    this.pid = options.pid ?? process.pid;
    this.timeoutMs = normalizeTimeout(options.timeoutMs ?? defaultTimeoutMs);
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.getTitleHint = options.getTitleHint;
  }

  public getCurrentWindowDisplay(): Promise<DetectorResult> {
    const titleHint = this.getTitleHint?.()?.trim();
    const request: HelperRequest = {
      op: 'getCurrentWindowDisplay',
      pid: this.pid,
      ...(titleHint ? { titleHint } : {})
    };

    return this.enqueue(() => this.callHelper(request));
  }

  public dispose(): void {
    this.disposed = true;
    this.rejectPending(new HelperClientError('helper_error', 'Native helper client was disposed.'));
    this.killChild();
  }

  private enqueue(operation: () => Promise<DetectorResult>): Promise<DetectorResult> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private callHelper(request: HelperRequest): Promise<DetectorResult> {
    if (this.disposed) {
      return Promise.reject(new HelperClientError('helper_error', 'Native helper client was disposed.'));
    }

    return new Promise<DetectorResult>((resolve, reject) => {
      try {
        this.ensureChild();
      } catch (error) {
        reject(error);
        return;
      }

      const child = this.child;
      if (!child || child.killed || child.exitCode !== null) {
        reject(new HelperClientError('helper_error', 'Native helper process is not running.'));
        return;
      }

      const timeout = setTimeout(() => {
        this.rejectPending(new HelperTimeoutError(this.timeoutMs));
        this.killChild();
      }, this.timeoutMs);

      this.pending = { resolve, reject, timeout };

      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, 'utf8');
      } catch (error) {
        this.rejectPending(
          new HelperClientError(
            'helper_error',
            error instanceof Error ? error.message : String(error)
          )
        );
        this.killChild();
      }
    });
  }

  private ensureChild(): void {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return;
    }

    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    const child = this.spawnProcess(this.helperPath, [], { stdio: 'pipe' });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.consumeStdoutLines();
    });
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    child.on('error', (error) => {
      this.rejectPending(new HelperClientError('helper_error', error.message));
      this.child = undefined;
    });
    child.on('close', (exitCode, signal) => {
      if (this.pending) {
        this.rejectPending(new HelperProcessError(exitCode, signal, this.stderrBuffer.trim()));
      }
      this.child = undefined;
    });
  }

  private consumeStdoutLines(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim().length === 0) {
        continue;
      }

      const pending = this.pending;
      if (!pending) {
        continue;
      }

      this.pending = undefined;
      clearTimeout(pending.timeout);

      try {
        pending.resolve(parseHelperOutput(line));
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  private rejectPending(error: unknown): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.pending = undefined;
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private killChild(): void {
    const child = this.child;
    this.child = undefined;
    if (!child || child.killed) {
      return;
    }

    try {
      child.kill();
    } catch {
      // Ignore kill races.
    }
  }
}

function normalizeTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < minTimeoutMs || timeoutMs > maxTimeoutMs) {
    throw new HelperClientError(
      'helper_error',
      `Native helper timeout must be between ${minTimeoutMs} and ${maxTimeoutMs} ms.`
    );
  }

  return timeoutMs;
}

export function parseHelperOutput(output: string): DetectorResult {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().length > 0);

  if (!line) {
    throw new HelperProtocolError('Native helper returned no JSON output.');
  }

  let response: unknown;
  try {
    response = JSON.parse(line);
  } catch (error) {
    throw new HelperProtocolError(`Native helper returned invalid JSON: ${String(error)}.`);
  }

  if (!isRecord(response) || typeof response.ok !== 'boolean') {
    throw new HelperProtocolError('Native helper response must include a boolean ok field.');
  }

  if (!response.ok) {
    if (typeof response.error !== 'string' || response.error.length === 0) {
      throw new HelperProtocolError('Native helper error response must include a non-empty error field.');
    }

    throw new NativeHelperError(response.error);
  }

  if (!isDetectorResult(response.data)) {
    throw new HelperProtocolError('Native helper success response includes invalid detector data.');
  }

  return response.data;
}

function isDetectorResult(value: unknown): value is DetectorResult {
  if (!isRecord(value)) {
    return false;
  }

  return isWindowBounds(value.window) && isDetectedDisplay(value.display);
}

function isWindowBounds(value: unknown): value is DetectorResult['window'] {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height);
}

function isDetectedDisplay(value: unknown): value is DetectorResult['display'] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && isFiniteNumber(value.scaleFactor);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatExit(exitCode: number | null, signal: NodeJS.Signals | null): string {
  if (exitCode !== null) {
    return `exit code ${exitCode}`;
  }

  return signal === null ? 'unknown exit status' : `signal ${signal}`;
}
