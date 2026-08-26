import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRelativeZoomCommandSequence,
  CommandZoomApplier,
  type VscodeZoomApi,
  type ZoomApplierLogger
} from './zoomApplier';
import { ZoomTracker } from './zoomTracker';

test('builds command sequence from configured baseline to target integer', () => {
  assert.deepEqual(buildRelativeZoomCommandSequence(0, 2), [
    'workbench.action.zoomIn',
    'workbench.action.zoomIn'
  ]);
  assert.deepEqual(buildRelativeZoomCommandSequence(1, -1), [
    'workbench.action.zoomOut',
    'workbench.action.zoomOut'
  ]);
});

test('handles fractional configured baseline using VS Code rounding behavior', () => {
  assert.deepEqual(buildRelativeZoomCommandSequence(0.5, 1), [
    'workbench.action.zoomIn',
    'workbench.action.zoomOut'
  ]);
});

test('rounds fractional target and tracks inexact integer application', async () => {
  const vscodeApi = new FakeVscodeZoomApi({
    zoomPerWindow: true,
    zoomLevel: 0
  });
  const tracker = new ZoomTracker();
  const logger = new RecordingLogger();
  const applier = new CommandZoomApplier({ vscodeApi, tracker, logger });

  await applier.applyZoomToCurrentWindow(1.5);

  assert.deepEqual(vscodeApi.executedCommands, [
    'workbench.action.zoomReset',
    'workbench.action.zoomIn',
    'workbench.action.zoomIn'
  ]);
  assert.deepEqual(tracker.getLastApplication(), {
    requestedZoom: 1.5,
    appliedZoom: 2,
    exact: false,
    resetBaseline: 0,
    commandCount: 2
  });
  assert.match(logger.messages[0], /Clamped requested zoom 1\.5/);
});

test('refuses when window.zoomPerWindow is false and leaves tracker unchanged', async () => {
  const vscodeApi = new FakeVscodeZoomApi({
    zoomPerWindow: false,
    zoomLevel: 0
  });
  const tracker = new ZoomTracker();
  const applier = new CommandZoomApplier({ vscodeApi, tracker });

  await assert.rejects(
    () => applier.applyZoomToCurrentWindow(1),
    /window\.zoomPerWindow is false/
  );
  assert.deepEqual(vscodeApi.executedCommands, []);
  assert.equal(tracker.getLastApplication(), undefined);
});

test('updates tracker only after all zoom commands complete', async () => {
  const vscodeApi = new FakeVscodeZoomApi({
    zoomPerWindow: true,
    zoomLevel: 0,
    failOnCommand: 'workbench.action.zoomIn'
  });
  const tracker = new ZoomTracker();
  const applier = new CommandZoomApplier({ vscodeApi, tracker });

  await assert.rejects(
    () => applier.applyZoomToCurrentWindow(1),
    /Command failed/
  );
  assert.deepEqual(vscodeApi.executedCommands, [
    'workbench.action.zoomReset',
    'workbench.action.zoomIn'
  ]);
  assert.equal(tracker.getLastApplication(), undefined);
});

test('skips command sequence when tracker already matches target', async () => {
  const vscodeApi = new FakeVscodeZoomApi({
    zoomPerWindow: true,
    zoomLevel: 0
  });
  const tracker = new ZoomTracker();
  const logger = new RecordingLogger();
  const applier = new CommandZoomApplier({ vscodeApi, tracker, logger });

  await applier.applyZoomToCurrentWindow(2);
  const commandsAfterFirst = vscodeApi.executedCommands.length;
  await applier.applyZoomToCurrentWindow(2);

  assert.equal(vscodeApi.executedCommands.length, commandsAfterFirst);
  assert.match(logger.messages.join('\n'), /Already at zoom 2/);
});

test('coalesces burst applies to the latest target', async () => {
  const vscodeApi = new FakeVscodeZoomApi({
    zoomPerWindow: true,
    zoomLevel: 0,
    commandDelayMs: 15
  });
  const tracker = new ZoomTracker();
  const applier = new CommandZoomApplier({ vscodeApi, tracker });

  const first = applier.applyZoomToCurrentWindow(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = applier.applyZoomToCurrentWindow(2);
  const third = applier.applyZoomToCurrentWindow(3);
  await Promise.all([first, second, third]);

  assert.equal(tracker.getLastApplication()?.appliedZoom, 3);
  const resetCount = vscodeApi.executedCommands.filter(
    (command) => command === 'workbench.action.zoomReset'
  ).length;
  assert.equal(resetCount, 2);
});

class FakeVscodeZoomApi implements VscodeZoomApi {
  public readonly executedCommands: string[] = [];
  public readonly commands = {
    executeCommand: async (command: string): Promise<unknown> => {
      this.executedCommands.push(command);

      if (this.commandDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.commandDelayMs));
      }

      if (command === this.failOnCommand) {
        throw new Error(`Command failed: ${command}`);
      }

      return undefined;
    }
  };
  public readonly workspace = {
    getConfiguration: () => ({
      get: <T>(section: string, defaultValue: T): T => {
        if (section === 'zoomPerWindow') {
          return this.zoomPerWindow as T;
        }

        if (section === 'zoomLevel') {
          return this.zoomLevel as T;
        }

        return defaultValue;
      }
    })
  };
  private readonly zoomPerWindow: boolean;
  private readonly zoomLevel: number;
  private readonly failOnCommand?: string;
  private readonly commandDelayMs: number;

  public constructor(options: {
    zoomPerWindow: boolean;
    zoomLevel: number;
    failOnCommand?: string;
    commandDelayMs?: number;
  }) {
    this.zoomPerWindow = options.zoomPerWindow;
    this.zoomLevel = options.zoomLevel;
    this.failOnCommand = options.failOnCommand;
    this.commandDelayMs = options.commandDelayMs ?? 0;
  }
}

class RecordingLogger implements ZoomApplierLogger {
  public readonly messages: string[] = [];

  public info(message: string): void {
    this.messages.push(message);
  }
}
