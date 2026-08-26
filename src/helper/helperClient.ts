import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';

import type { DetectorResult } from '../display/types';

export interface HelperClient {
  getCurrentWindowDisplay(): Promise<DetectorResult>;
  startWatch?(
    onChange: (result: DetectorResult) => void,
    onError?: (error: unknown) => void
  ): Promise<void>;
  stopWatch?(): Promise<void>;
  dispose?(): void;
}

export interface HelperClientOptions {
  pid?: number;
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
  getTitleHint?: () => string | undefined;
  watchIntervalMs?: number;
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
  op: 'getCurrentWindowDisplay' | 'watch' | 'unwatch';
  pid?: number;
  titleHint?: string;
  intervalMs?: number;
  requestId?: string;
}

const defaultTimeoutMs = 1500;
const minTimeoutMs = 200;
const maxTimeoutMs = 5000;
const defaultWatchIntervalMs = 200;

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

export class JsonLineHelperClient implements HelperClient {
  private readonly helperPath: string;
  private readonly pid: number;
  private readonly timeoutMs: number;
  private readonly watchIntervalMs: number;
  private readonly spawnProcess: SpawnProcess;
  private readonly getTitleHint?: () => string | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private queue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<
    string,
    {
      resolve: (value: DetectorResult | void) => void;
      reject: (error: unknown) => void;
      timeout: NodeJS.Timeout;
      expectData: boolean;
    }
  >();
  private watchListener: ((result: DetectorResult) => void) | undefined;
  private watchErrorListener: ((error: unknown) => void) | undefined;
  private disposed = false;

  public constructor(helperPath: string, options: HelperClientOptions = {}) {
    this.helperPath = helperPath;
    this.pid = options.pid ?? process.pid;
    this.timeoutMs = normalizeTimeout(options.timeoutMs ?? defaultTimeoutMs);
    this.watchIntervalMs = options.watchIntervalMs ?? defaultWatchIntervalMs;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.getTitleHint = options.getTitleHint;
  }

  public getCurrentWindowDisplay(): Promise<DetectorResult> {
    const titleHint = this.getTitleHint?.()?.trim();
    return this.enqueue(async () => {
      const result = await this.sendRequest({
        op: 'getCurrentWindowDisplay',
        pid: this.pid,
        ...(titleHint ? { titleHint } : {})
      }, true);
      return result as DetectorResult;
    });
  }

  public async startWatch(
    onChange: (result: DetectorResult) => void,
    onError?: (error: unknown) => void
  ): Promise<void> {
    this.watchListener = onChange;
    this.watchErrorListener = onError;
    const titleHint = this.getTitleHint?.()?.trim();
    await this.enqueue(async () => {
      const first = await this.sendRequest({
        op: 'watch',
        pid: this.pid,
        intervalMs: this.watchIntervalMs,
        ...(titleHint ? { titleHint } : {})
      }, true);
      if (first) {
        onChange(first as DetectorResult);
      }
    });
  }

  public async stopWatch(): Promise<void> {
    this.watchListener = undefined;
    this.watchErrorListener = undefined;
    await this.enqueue(async () => {
      await this.sendRequest({ op: 'unwatch' }, false);
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.watchListener = undefined;
    this.watchErrorListener = undefined;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new HelperClientError('helper_error', 'Native helper client was disposed.'));
      this.pending.delete(requestId);
    }
    this.killChild();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private sendRequest(request: Omit<HelperRequest, 'requestId'>, expectData: boolean): Promise<DetectorResult | void> {
    if (this.disposed) {
      return Promise.reject(new HelperClientError('helper_error', 'Native helper client was disposed.'));
    }

    return new Promise<DetectorResult | void>((resolve, reject) => {
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

      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new HelperTimeoutError(this.timeoutMs));
        // Do not kill the whole helper on one timeout; watch may still be useful.
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout, expectData });

      try {
        child.stdin.write(`${JSON.stringify({ ...request, requestId })}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(
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
      this.failAllPending(new HelperClientError('helper_error', error.message));
      this.child = undefined;
    });
    child.on('close', (exitCode, signal) => {
      this.failAllPending(new HelperProcessError(exitCode, signal, this.stderrBuffer.trim()));
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

      this.dispatchLine(line);
    }
  }

  private dispatchLine(line: string): void {
    let response: unknown;
    try {
      response = JSON.parse(line);
    } catch (error) {
      this.watchErrorListener?.(
        new HelperProtocolError(`Native helper returned invalid JSON: ${String(error)}.`)
      );
      return;
    }

    if (!isRecord(response) || typeof response.ok !== 'boolean') {
      this.watchErrorListener?.(
        new HelperProtocolError('Native helper response must include a boolean ok field.')
      );
      return;
    }

    const requestId = typeof response.requestId === 'string' ? response.requestId : undefined;
    const pending = this.takePending(requestId);
    if (pending) {
      clearTimeout(pending.timeout);

      try {
        if (!response.ok) {
          if (typeof response.error !== 'string' || response.error.length === 0) {
            throw new HelperProtocolError('Native helper error response must include a non-empty error field.');
          }
          throw new NativeHelperError(response.error);
        }

        if (typeof response.event === 'string') {
          pending.resolve();
          return;
        }

        if (!pending.expectData) {
          pending.resolve();
          return;
        }

        if (!isDetectorResult(response.data)) {
          throw new HelperProtocolError('Native helper success response includes invalid detector data.');
        }

        pending.resolve(response.data);
      } catch (error) {
        pending.reject(error);
      }
      return;
    }

    // Spontaneous watch update (display change push).
    if (response.ok && isDetectorResult(response.data)) {
      this.watchListener?.(response.data);
      return;
    }

    if (!response.ok && typeof response.error === 'string') {
      this.watchErrorListener?.(new NativeHelperError(response.error));
    }
  }

  private takePending(requestId: string | undefined): {
    resolve: (value: DetectorResult | void) => void;
    reject: (error: unknown) => void;
    timeout: NodeJS.Timeout;
    expectData: boolean;
  } | undefined {
    if (requestId && this.pending.has(requestId)) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      return pending;
    }

    // Older helpers may omit requestId; correlate when exactly one request is in flight.
    if (!requestId && this.pending.size === 1) {
      const onlyId = this.pending.keys().next().value as string;
      const pending = this.pending.get(onlyId);
      this.pending.delete(onlyId);
      return pending;
    }

    return undefined;
  }

  private failAllPending(error: unknown): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(requestId);
    }
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
