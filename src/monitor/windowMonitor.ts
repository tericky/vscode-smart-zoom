import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity, DetectorResult } from '../display/types';
import type { ResolveZoomInput } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';

export interface ZoomApplier {
  applyZoomToCurrentWindow(target: number, display?: DisplayIdentity): Promise<void>;
}

export interface LoggerLike {
  info(message: string): void;
}

export interface WindowMonitorOptions {
  helperClient: HelperClient;
  getConfig: () => AutoZoomConfig;
  resolveZoom: (input: ResolveZoomInput) => number;
  zoomApplier: ZoomApplier;
  logger?: LoggerLike;
  scheduler?: PollScheduler;
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

const defaultPollInterval = 150;
const defaultStabilityChecks = 2;

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
  private readonly getConfig: () => AutoZoomConfig;
  private readonly resolveZoom: (input: ResolveZoomInput) => number;
  private readonly zoomApplier: ZoomApplier;
  private readonly logger?: LoggerLike;
  private readonly scheduler: PollScheduler;
  private stabilityState: DisplayStabilityState = { consecutiveCandidateCount: 0 };
  private intervalHandle: unknown;
  private polling = false;

  public constructor(options: WindowMonitorOptions) {
    this.helperClient = options.helperClient;
    this.getConfig = options.getConfig;
    this.resolveZoom = options.resolveZoom;
    this.zoomApplier = options.zoomApplier;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  public start(): void {
    if (this.intervalHandle !== undefined) {
      return;
    }

    const config = this.getConfig();
    const pollInterval = normalizePositiveInteger(config.pollInterval, defaultPollInterval);
    this.intervalHandle = this.scheduler.setInterval(() => {
      void this.pollOnce();
    }, pollInterval);
  }

  public stop(): void {
    if (this.intervalHandle === undefined) {
      return;
    }

    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
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

    this.polling = true;

    try {
      const config = this.getConfig();
      if (config.enabled === false) {
        return;
      }

      const detection = await this.helperClient.getCurrentWindowDisplay();
      const decision = shouldApplyDisplayChange(
        this.stabilityState,
        detection.display.id,
        config.stabilityChecks
      );

      if (!decision.shouldApply) {
        this.stabilityState = decision.nextState;
        return;
      }

      const display = toDisplayIdentity(detection);
      const targetZoom = this.resolveZoom({ display, config });
      await this.zoomApplier.applyZoomToCurrentWindow(targetZoom, display);
      this.stabilityState = decision.nextState;
    } catch (error) {
      this.logger?.info(`Window monitor skipped zoom update: ${formatError(error)}`);
    } finally {
      this.polling = false;
    }
  }
}

function toDisplayIdentity(result: DetectorResult): DisplayIdentity {
  return {
    displayId: result.display.id,
    name: result.display.name,
    width: result.display.width,
    height: result.display.height,
    scaleFactor: result.display.scaleFactor
  };
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
