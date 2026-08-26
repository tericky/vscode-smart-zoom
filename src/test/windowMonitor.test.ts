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
  assert.equal(scheduler.intervals[0].delayMs, 150);

  monitor.stop();
  monitor.stop();
  assert.deepEqual(scheduler.clearedHandles, [scheduler.intervals[0].handle]);
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
