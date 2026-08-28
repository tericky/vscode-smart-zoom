import type { SmartZoomConfig } from '../config/types';
import { toDisplayIdentity } from '../display/identity';
import type { DisplayIdentity, DetectorResult } from '../display/types';
import type { ResolveZoomInput } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';
import { clampZoomLevel } from '../zoom/zoomFormat';

export interface ZoomApplyContext {
  source?: 'auto' | 'manual' | 'startup';
}

export interface ZoomApplier {
  applyZoomToCurrentWindow(
    target: number,
    display?: DisplayIdentity,
    context?: ZoomApplyContext
  ): Promise<void>;
}

export interface LoggerLike {
  info(message: string): void;
}

export interface WindowMonitorOptions {
  helperClient: HelperClient;
  getConfig: () => SmartZoomConfig;
  resolveZoom: (input: ResolveZoomInput) => number;
  zoomApplier: ZoomApplier;
  logger?: LoggerLike;
  scheduler?: PollScheduler;
  /**
   * When false, skip detection/apply. Multi-window hosts share one app PID, so the
   * helper may report the focused sibling window's display while this host is blurred.
   */
  isWindowFocused?: () => boolean;
}

export interface DisplayStabilityState {
  currentDisplayId?: string;
  candidateDisplayId?: string;
  consecutiveCandidateCount: number;
}

export interface DisplayStabilityDecision {
  nextState: DisplayStabilityState;
  shouldApply: boolean;
  displayId: string;
}

export interface PollScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultPollInterval = 500;
const defaultStabilityChecks = 2;
const maxErrorBackoffMs = 10000;

const defaultScheduler: PollScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export function shouldApplyDisplayChange(
  state: DisplayStabilityState,
  observedDisplayId: string,
  stabilityChecks = defaultStabilityChecks
): DisplayStabilityDecision {
  const requiredChecks = normalizePositiveInteger(stabilityChecks, defaultStabilityChecks);

  if (state.currentDisplayId === observedDisplayId) {
    return {
      nextState: {
        currentDisplayId: state.currentDisplayId,
        consecutiveCandidateCount: 0
      },
      shouldApply: false,
      displayId: observedDisplayId
    };
  }

  const consecutiveCandidateCount = state.candidateDisplayId === observedDisplayId
    ? state.consecutiveCandidateCount + 1
    : 1;

  if (consecutiveCandidateCount >= requiredChecks) {
    return {
      nextState: {
        currentDisplayId: observedDisplayId,
        consecutiveCandidateCount: 0
      },
      shouldApply: true,
      displayId: observedDisplayId
    };
  }

  return {
    nextState: {
      currentDisplayId: state.currentDisplayId,
      candidateDisplayId: observedDisplayId,
      consecutiveCandidateCount
    },
    shouldApply: false,
    displayId: observedDisplayId
  };
}

export class WindowMonitor {
  private readonly helperClient: HelperClient;
  private readonly getConfig: () => SmartZoomConfig;
  private readonly resolveZoom: (input: ResolveZoomInput) => number;
  private readonly zoomApplier: ZoomApplier;
  private readonly logger?: LoggerLike;
  private readonly scheduler: PollScheduler;
  private readonly isWindowFocused?: () => boolean;
  private stabilityState: DisplayStabilityState = { consecutiveCandidateCount: 0 };
  private intervalHandle: unknown;
  private polling = false;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private lastLoggedError: string | undefined;
  private mode: 'watch' | 'poll' | 'stopped' = 'stopped';
  private applying = false;
  private pendingDetection: DetectorResult | undefined;
  private runId = 0;
  /**
   * After blur, the helper may briefly report a sibling window's display
   * (shared app PID). Require extra confirmation before applying.
   */
  private settleAfterFocus = false;

  public constructor(options: WindowMonitorOptions) {
    this.helperClient = options.helperClient;
    this.getConfig = options.getConfig;
    this.resolveZoom = options.resolveZoom;
    this.zoomApplier = options.zoomApplier;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.isWindowFocused = options.isWindowFocused;
  }

  public start(): void {
    if (this.mode !== 'stopped') {
      return;
    }

    const runId = ++this.runId;

    if (typeof this.helperClient.startWatch === 'function') {
      this.mode = 'watch';
      void this.helperClient.startWatch(
        (detection) => {
          if (runId !== this.runId) {
            return;
          }
          void this.handleDetection(detection);
        },
        (error) => {
          if (runId !== this.runId) {
            return;
          }
          this.onHelperFailure(error);
        }
      ).then(() => {
        if (runId !== this.runId) {
          return;
        }
        this.logger?.info('Window monitor started in event/watch mode.');
      }).catch((error: unknown) => {
        if (runId !== this.runId) {
          return;
        }
        this.logger?.info(
          `Watch mode unavailable (${formatError(error)}); falling back to polling.`
        );
        void this.fallbackToPolling(runId);
      });
      return;
    }

    this.startPolling();
  }

  public stop(): void {
    this.runId += 1;
    void this.helperClient.stopWatch?.();

    if (this.intervalHandle !== undefined) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    this.mode = 'stopped';
    this.pendingDetection = undefined;
  }

  public seedCurrentDisplay(displayId: string): void {
    this.stabilityState = {
      currentDisplayId: displayId,
      consecutiveCandidateCount: 0
    };
  }

  public async pollOnce(): Promise<void> {
    if (this.polling) {
      return;
    }

    if (this.isWindowFocused && !this.isWindowFocused()) {
      this.settleAfterFocus = true;
      return;
    }

    this.polling = true;

    try {
      const config = this.getConfig();
      if (config.enabled === false) {
        return;
      }

      const now = Date.now();
      if (now < this.nextAttemptAt) {
        return;
      }

      const detection = await this.helperClient.getCurrentWindowDisplay();
      await this.handleDetection(detection);
    } catch (error) {
      this.onHelperFailure(error);
    } finally {
      this.polling = false;
    }
  }

  private startPolling(): void {
    if (this.intervalHandle !== undefined) {
      return;
    }

    this.mode = 'poll';
    const config = this.getConfig();
    const pollInterval = normalizePositiveInteger(config.pollInterval, defaultPollInterval);
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.pollOnce();
    }, pollInterval);
    this.logger?.info(`Window monitor started in poll mode (${pollInterval}ms).`);
  }

  private async fallbackToPolling(runId: number): Promise<void> {
    if (runId !== this.runId) {
      return;
    }

    try {
      await this.helperClient.stopWatch?.();
    } catch {
      // Ignore unwatch races when watch never fully started.
    }

    if (runId !== this.runId) {
      return;
    }

    this.mode = 'stopped';
    this.startPolling();
  }

  private async handleDetection(detection: DetectorResult): Promise<void> {
    if (this.isWindowFocused && !this.isWindowFocused()) {
      // Do not update stability from another window's geometry.
      this.settleAfterFocus = true;
      this.pendingDetection = undefined;
      return;
    }

    if (this.applying) {
      this.pendingDetection = detection;
      return;
    }

    const runId = this.runId;
    const config = this.getConfig();
    if (config.enabled === false) {
      this.pendingDetection = undefined;
      return;
    }

    this.onHelperSuccess();

    if (
      this.settleAfterFocus &&
      this.stabilityState.currentDisplayId === detection.display.id
    ) {
      this.settleAfterFocus = false;
    }

    // Watch events already fire only when display id changes; skip multi-poll stability.
    // After blur, require two matching samples so a sibling window is not applied.
    const stabilityChecks = this.settleAfterFocus
      ? Math.max(2, this.mode === 'watch' ? 2 : config.stabilityChecks ?? 2)
      : this.mode === 'watch'
        ? 1
        : config.stabilityChecks;
    const decision = shouldApplyDisplayChange(
      this.stabilityState,
      detection.display.id,
      stabilityChecks
    );

    if (!decision.shouldApply) {
      this.stabilityState = decision.nextState;
      return;
    }

    this.settleAfterFocus = false;

    this.applying = true;
    try {
      const display = toDisplayIdentity(detection);
      const targetZoom = clampZoomLevel(this.resolveZoom({ display, config }));
      await this.zoomApplier.applyZoomToCurrentWindow(targetZoom, display, { source: 'auto' });
      if (runId === this.runId) {
        this.stabilityState = decision.nextState;
      }
    } catch (error) {
      this.logger?.info(`Failed to apply zoom: ${formatError(error)}`);
    } finally {
      this.applying = false;
      if (runId !== this.runId) {
        return;
      }
      const pending = this.pendingDetection;
      this.pendingDetection = undefined;
      if (pending) {
        void this.handleDetection(pending);
      }
    }
  }

  private onHelperSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.logger?.info('Window monitor recovered; display detection is working again.');
    }
    this.consecutiveFailures = 0;
    this.nextAttemptAt = 0;
    this.lastLoggedError = undefined;
  }

  private onHelperFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    const message = formatError(error);
    const backoffMs = Math.min(
      maxErrorBackoffMs,
      500 * 2 ** Math.min(this.consecutiveFailures - 1, 4)
    );
    this.nextAttemptAt = Date.now() + backoffMs;

    if (this.lastLoggedError !== message) {
      this.lastLoggedError = message;
      this.logger?.info(
        `Window monitor paused detection for ${backoffMs}ms: ${message}`
      );
    }
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
