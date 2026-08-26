import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';

import type { DetectorResult } from '../display/types';

export interface HelperClient {
  getCurrentWindowDisplay(): Promise<DetectorResult>;
}

export interface HelperClientOptions {
  pid?: number;
  timeoutMs?: number;
  spawnProcess?: SpawnProcess;
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
}

type HelperResponse =
  | { ok: true; data: DetectorResult }
  | { ok: false; error: string };

const defaultTimeoutMs = 300;
const minTimeoutMs = 200;
const maxTimeoutMs = 500;

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
  private readonly spawnProcess: SpawnProcess;

  public constructor(helperPath: string, options: HelperClientOptions = {}) {
    this.helperPath = helperPath;
    this.pid = options.pid ?? process.pid;
    this.timeoutMs = normalizeTimeout(options.timeoutMs ?? defaultTimeoutMs);
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  public getCurrentWindowDisplay(): Promise<DetectorResult> {
    return this.callHelper({ op: 'getCurrentWindowDisplay', pid: this.pid });
  }

  private callHelper(request: HelperRequest): Promise<DetectorResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = this.spawnProcess(this.helperPath, [], { stdio: 'pipe' });
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        callback();
      };

      const timeout = setTimeout(() => {
        child.kill();
        settle(() => reject(new HelperTimeoutError(this.timeoutMs)));
      }, this.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        settle(() => reject(new HelperClientError('helper_error', error.message)));
      });
      child.on('close', (exitCode, signal) => {
        settle(() => {
          if (exitCode !== 0) {
            reject(new HelperProcessError(exitCode, signal, stderr.trim()));
            return;
          }

          try {
            resolve(parseHelperOutput(stdout));
          } catch (error) {
            reject(error);
          }
        });
      });

      child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8');
    });
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

function parseHelperOutput(output: string): DetectorResult {
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
