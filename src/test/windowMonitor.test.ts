import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AutoZoomConfig } from '../config/types';
import type { DetectorResult, DisplayIdentity } from '../display/types';
import {
  shouldApplyDisplayChange,
  WindowMonitor,
  type DisplayStabilityState,
  type PollScheduler
} from '../monitor/windowMonitor';

const baseConfig: AutoZoomConfig = {
  enabled: true,
  defaultZoom: 0,
  displayProfiles: {},
  zoomRules: []
};

test('does not apply when display observations jitter A/B/A', () => {
  let state: DisplayStabilityState = {
    currentDisplayId: 'display-a',
    consecutiveCandidateCount: 0
  };

  const firstDecision = shouldApplyDisplayChange(state, 'display-b', 2);
  assert.equal(firstDecision.shouldApply, false);
  state = firstDecision.nextState;

  const secondDecision = shouldApplyDisplayChange(state, 'display-a', 2);
  assert.equal(secondDecision.shouldApply, false);
  assert.deepEqual(secondDecision.nextState, {
    currentDisplayId: 'display-a',
    consecutiveCandidateCount: 0
  });
});

test('applies after N consecutive observations of the same candidate display', () => {
  let state: DisplayStabilityState = {
    currentDisplayId: 'display-a',
    consecutiveCandidateCount: 0
  };

  const firstDecision = shouldApplyDisplayChange(state, 'display-b', 2);
  assert.equal(firstDecision.shouldApply, false);
  state = firstDecision.nextState;

  const secondDecision = shouldApplyDisplayChange(state, 'display-b', 2);
  assert.equal(secondDecision.shouldApply, true);
  assert.deepEqual(secondDecision.nextState, {
    currentDisplayId: 'display-b',
    consecutiveCandidateCount: 0
  });
});

test('start uses default polling interval and stop clears the timer', () => {
  const scheduler = new FakeScheduler();
  const monitor = new WindowMonitor({
    helperClient: new SequenceHelper([]),
    getConfig: () => baseConfig,
    resolveZoom: () => 0,
    zoomApplier: new RecordingZoomApplier(),
    scheduler
  });

  monitor.start();
  monitor.start();
  assert.equal(scheduler.intervals.length, 1);
  assert.equal(scheduler.intervals[0].delayMs, 500);

  monitor.stop();
  monitor.stop();
  assert.deepEqual(scheduler.clearedHandles, [scheduler.intervals[0].handle]);
});

test('start prefers watch mode when helper supports startWatch', async () => {
  const helper = new WatchCapableHelper();
  const zoomApplier = new RecordingZoomApplier();
  const logger = new RecordingLogger();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => ({
      ...baseConfig,
      displayProfiles: {
        'display-b': {
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          zoom: 1
        }
      }
    }),
    resolveZoom: ({ config, display }) => config.displayProfiles[display.displayId ?? '']?.zoom ?? 0,
    zoomApplier,
    logger,
    scheduler: new FakeScheduler()
  });

  monitor.seedCurrentDisplay('display-a');
  monitor.start();
  await helper.started;
  assert.equal(helper.watchStarted, true);

  helper.emit(createDetectorResult('display-b'));
  await waitFor(() => zoomApplier.appliedZooms.length === 1);
  assert.deepEqual(zoomApplier.appliedZooms, [1]);
  assert.match(logger.messages.join('\n'), /event\/watch mode/);

  monitor.stop();
  assert.equal(helper.watchStopped, true);
});

test('watch failure falls back to polling', async () => {
  const scheduler = new FakeScheduler();
  const helper = new WatchCapableHelper({ failStart: true });
  const logger = new RecordingLogger();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => baseConfig,
    resolveZoom: () => 0,
    zoomApplier: new RecordingZoomApplier(),
    logger,
    scheduler
  });

  monitor.start();
  await helper.started;
  await waitFor(() => scheduler.intervals.length === 1);
  assert.equal(scheduler.intervals[0].delayMs, 500);
  assert.match(logger.messages.join('\n'), /falling back to polling/);
});

test('stop cancels in-flight watch failure fallback', async () => {
  const scheduler = new FakeScheduler();
  const helper = new WatchCapableHelper({ failStart: true, failDelayMs: 40 });
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => baseConfig,
    resolveZoom: () => 0,
    zoomApplier: new RecordingZoomApplier(),
    scheduler
  });

  monitor.start();
  await helper.started;
  monitor.stop();
  await waitFor(() => helper.watchStopped);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(scheduler.intervals.length, 0);
});

test('queues latest detection while applying zoom', async () => {
  const helper = new WatchCapableHelper();
  const zoomApplier = new GateZoomApplier();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => ({
      ...baseConfig,
      displayProfiles: {
        'display-a': {
          width: 3840,
          height: 2160,
          scaleFactor: 2,
          zoom: 1
        },
        'display-b': {
          width: 2560,
          height: 1440,
          scaleFactor: 1,
          zoom: 2
        },
        'display-c': {
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          zoom: 3
        }
      }
    }),
    resolveZoom: ({ config, display }) => config.displayProfiles[display.displayId ?? '']?.zoom ?? 0,
    zoomApplier
  });

  monitor.start();
  await helper.started;
  helper.emit(createDetectorResult('display-a'));
  await waitFor(() => zoomApplier.startedCount === 1);

  helper.emit(createDetectorResult('display-b'));
  helper.emit(createDetectorResult('display-c'));
  zoomApplier.release();
  await waitFor(() => zoomApplier.appliedZooms.length === 2);

  assert.deepEqual(zoomApplier.appliedZooms, [1, 3]);
  assert.equal(zoomApplier.appliedDisplays[1]?.displayId, 'display-c');
});

test('applies resolved zoom after stable display detection only once for unchanged display', async () => {
  const helper = new SequenceHelper([
    createDetectorResult('display-a'),
    createDetectorResult('display-a'),
    createDetectorResult('display-a')
  ]);
  const zoomApplier = new RecordingZoomApplier();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => ({
      ...baseConfig,
      stabilityChecks: 2,
      displayProfiles: {
        'display-a': {
          width: 3840,
          height: 2160,
          scaleFactor: 2,
          zoom: 2
        }
      }
    }),
    resolveZoom: ({ config, display }) => config.displayProfiles[display.displayId ?? '']?.zoom ?? 0,
    zoomApplier
  });

  await monitor.pollOnce();
  await monitor.pollOnce();
  await monitor.pollOnce();

  assert.deepEqual(zoomApplier.appliedZooms, [2]);
  assert.equal(zoomApplier.appliedDisplays[0]?.displayId, 'display-a');
});

test('seeded startup display does not trigger an immediate re-apply', async () => {
  const helper = new SequenceHelper([
    createDetectorResult('display-a'),
    createDetectorResult('display-a')
  ]);
  const zoomApplier = new RecordingZoomApplier();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => ({ ...baseConfig, stabilityChecks: 2 }),
    resolveZoom: () => 2,
    zoomApplier
  });

  monitor.seedCurrentDisplay('display-a');
  await monitor.pollOnce();
  await monitor.pollOnce();

  assert.deepEqual(zoomApplier.appliedZooms, []);
});

test('ignores detections while the window is unfocused', async () => {
  const helper = new SequenceHelper([createDetectorResult('display-a')]);
  const zoomApplier = new RecordingZoomApplier();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => ({
      ...baseConfig,
      stabilityChecks: 1,
      displayProfiles: {
        'display-a': {
          width: 3840,
          height: 2160,
          scaleFactor: 2,
          zoom: 2
        }
      }
    }),
    resolveZoom: ({ config, display }) => config.displayProfiles[display.displayId ?? '']?.zoom ?? 0,
    zoomApplier,
    isWindowFocused: () => false
  });

  await monitor.pollOnce();
  assert.deepEqual(zoomApplier.appliedZooms, []);
});

test('logs helper failure and keeps current zoom', async () => {
  const helper = new SequenceHelper([new Error('helper unavailable')]);
  const zoomApplier = new RecordingZoomApplier();
  const logger = new RecordingLogger();
  const monitor = new WindowMonitor({
    helperClient: helper,
    getConfig: () => baseConfig,
    resolveZoom: () => 1,
    zoomApplier,
    logger
  });

  await monitor.pollOnce();

  assert.deepEqual(zoomApplier.appliedZooms, []);
  assert.equal(logger.messages.length, 1);
  assert.match(logger.messages[0], /helper unavailable/);
});

class FakeScheduler implements PollScheduler {
  public readonly intervals: Array<{ handle: object; callback: () => void; delayMs: number }> = [];
  public readonly clearedHandles: unknown[] = [];

  public setInterval(callback: () => void, delayMs: number): unknown {
    const handle = {};
    this.intervals.push({ handle, callback, delayMs });
    return handle;
  }

  public clearInterval(handle: unknown): void {
    this.clearedHandles.push(handle);
  }
}

class SequenceHelper {
  private readonly results: Array<DetectorResult | Error>;

  public constructor(results: Array<DetectorResult | Error>) {
    this.results = [...results];
  }

  public async getCurrentWindowDisplay(): Promise<DetectorResult> {
    const result = this.results.shift();

    if (result === undefined) {
      throw new Error('No detector result queued.');
    }

    if (result instanceof Error) {
      throw result;
    }

    return result;
  }
}

class WatchCapableHelper {
  public watchStarted = false;
  public watchStopped = false;
  public readonly started: Promise<void>;
  private readonly failStart: boolean;
  private readonly failDelayMs: number;
  private markStarted!: () => void;
  private onChange: ((result: DetectorResult) => void) | undefined;

  public constructor(options: { failStart?: boolean; failDelayMs?: number } = {}) {
    this.failStart = options.failStart === true;
    this.failDelayMs = options.failDelayMs ?? 0;
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  public async getCurrentWindowDisplay(): Promise<DetectorResult> {
    throw new Error('getCurrentWindowDisplay should not be used in watch mode tests.');
  }

  public async startWatch(
    onChange: (result: DetectorResult) => void
  ): Promise<void> {
    this.watchStarted = true;
    this.onChange = onChange;
    this.markStarted();
    if (this.failStart) {
      if (this.failDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.failDelayMs));
      }
      throw new Error('unsupported_operation');
    }
  }

  public async stopWatch(): Promise<void> {
    this.watchStopped = true;
    this.onChange = undefined;
  }

  public emit(result: DetectorResult): void {
    this.onChange?.(result);
  }
}

class GateZoomApplier {
  public readonly appliedZooms: number[] = [];
  public readonly appliedDisplays: Array<DisplayIdentity | undefined> = [];
  public startedCount = 0;
  public release: () => void = () => undefined;
  private readonly gate: Promise<void>;

  public constructor() {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  public async applyZoomToCurrentWindow(
    target: number,
    display?: DisplayIdentity
  ): Promise<void> {
    this.startedCount += 1;
    this.appliedZooms.push(target);
    this.appliedDisplays.push(display);
    if (this.startedCount === 1) {
      await this.gate;
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

class RecordingZoomApplier {
  public readonly appliedZooms: number[] = [];
  public readonly appliedDisplays: Array<DisplayIdentity | undefined> = [];

  public async applyZoomToCurrentWindow(
    target: number,
    display?: DisplayIdentity
  ): Promise<void> {
    this.appliedZooms.push(target);
    this.appliedDisplays.push(display);
  }
}

class RecordingLogger {
  public readonly messages: string[] = [];

  public info(message: string): void {
    this.messages.push(message);
  }
}

function createDetectorResult(displayId: string): DetectorResult {
  return {
    window: {
      x: 0,
      y: 0,
      width: 1000,
      height: 800
    },
    display: {
      id: displayId,
      name: displayId,
      x: 0,
      y: 0,
      width: 3840,
      height: 2160,
      scaleFactor: 2
    }
  };
}
