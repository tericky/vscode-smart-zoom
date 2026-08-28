import * as vscode from 'vscode';
import { basename } from 'node:path';

import { registerCommands, toDisplayIdentity } from './commands/registerCommands';
import { getSmartZoomConfig } from './config/configStore';
import { resolveZoom } from './display/zoomResolver';
import { JsonLineHelperClient, NativeHelperError } from './helper/helperClient';
import { getHelperPath } from './helper/helperLocator';
import { prepareHelperBinary } from './helper/prepareHelper';
import { Logger } from './log/logger';
import { WindowMonitor } from './monitor/windowMonitor';
import { SmartZoomStatus, SmartZoomStatusBar } from './ui/statusBar';
import {
  disposeDisplayZoomToast,
  shouldAnnounceDisplayZoom,
  showDisplayZoomToast
} from './ui/zoomToast';
import { CommandZoomApplier } from './zoom/zoomApplier';
import { clampZoomLevel } from './zoom/zoomFormat';
import {
  createSpaceRestoreState,
  noteStableHome,
  noteWindowAway,
  noteWindowBack,
  shouldSkipSpuriousAutoZoomZero
} from './zoom/spaceZoomRestore';

let activeMonitor: WindowMonitor | undefined;
let activeStatusBar: SmartZoomStatusBar | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  context.subscriptions.push(logger);

  const initialConfig = getSmartZoomConfig();
  const zoomPerWindow = vscode.workspace
    .getConfiguration('window')
    .get<boolean>('zoomPerWindow', true);

  if (zoomPerWindow === false) {
    await vscode.window.showWarningMessage(
      'Smart Zoom requires window.zoomPerWindow to be enabled. Zoom changes will not be applied.'
    );
  }

  const helperPath = getHelperPath(context);
  await prepareHelperBinary(helperPath);

  const helperClient = new JsonLineHelperClient(helperPath, {
    getTitleHint: getBestEffortTitleHint
  });
  const commandZoomApplier = new CommandZoomApplier({ logger });
  let statusBar: SmartZoomStatusBar | undefined;
  let initialStatus: SmartZoomStatus | undefined;
  let waylandNoticeShown = false;
  let lastAppliedZoom: number | undefined;
  let spaceRestore = createSpaceRestoreState(vscode.env.appName);
  let stableHomeTimer: NodeJS.Timeout | undefined;

  const clearStableHomeTimer = (): void => {
    if (stableHomeTimer !== undefined) {
      clearTimeout(stableHomeTimer);
      stableHomeTimer = undefined;
    }
  };

  /**
   * Cursor resets per-window zoom to the settings baseline (100%) on Spaces.
   * zoomReset would flash 100%; climb from that baseline once per trip.
   * force is required because ZoomTracker still thinks we are at 120%.
   */
  const restoreRememberedZoomFromBaseline = async (reason: string): Promise<void> => {
    if (getSmartZoomConfig().enabled === false) {
      return;
    }
    const zoom = lastAppliedZoom;
    if (zoom === undefined || zoom === 0) {
      return;
    }
    try {
      await commandZoomApplier.applyZoomToCurrentWindow(zoom, {
        force: true,
        fromBaseline: true
      });
      lastAppliedZoom = zoom;
      logger.info(`Restore zoom ${zoom} from baseline (${reason}).`);
    } catch (error) {
      logger.info(`Baseline restore failed (${reason}): ${formatError(error)}`);
    }
  };

  const tryRestoreSpaceZoom = (reason: string): void => {
    const result = noteWindowBack(spaceRestore);
    spaceRestore = result.state;
    if (!result.shouldRestore) {
      return;
    }
    void restoreRememberedZoomFromBaseline(reason);
  };

  helperClient.onHelperEvent?.((event) => {
    logger.info(`Helper event: ${event}`);
    if (event === 'windowBecameHidden') {
      clearStableHomeTimer();
      spaceRestore = noteWindowAway(spaceRestore);
      return;
    }
    if (event === 'windowBecameVisible') {
      tryRestoreSpaceZoom('windowBecameVisible');
    }
  });

  const handleError = async (error: unknown): Promise<void> => {
    logger.info(`Smart Zoom operation failed: ${formatError(error)}`);

    if (error instanceof NativeHelperError && error.nativeError === 'wayland_unsupported') {
      if (!waylandNoticeShown) {
        waylandNoticeShown = true;
        await vscode.window.showWarningMessage(
          'Smart Zoom cannot detect the current display on Wayland. This platform limitation prevents automatic per-display zoom.'
        );
      }
      return;
    }

    await vscode.window.showErrorMessage(`Smart Zoom failed: ${formatError(error)}`);
  };

  const statusAwareZoomApplier = {
    applyZoomToCurrentWindow: async (
      target: number,
      display?: ReturnType<typeof toDisplayIdentity>,
      context?: { source?: 'auto' | 'manual' | 'startup' }
    ): Promise<void> => {
      const nextZoom = clampZoomLevel(target);
      // Only suppress spurious zoom 0 while away on a Space trip. Moving onto an
      // unconfigured display must still apply defaultZoom (often 0 / 100%).
      if (
        shouldSkipSpuriousAutoZoomZero({
          source: context?.source,
          nextZoom,
          lastAppliedZoom,
          spaceAway: spaceRestore.away
        })
      ) {
        logger.info(
          `Skip applying zoom 0 during Space trip; keeping remembered zoom ${lastAppliedZoom}.`
        );
        return;
      }

      const previousZoom = commandZoomApplier.tracker.getLastApplication()?.appliedZoom;
      await commandZoomApplier.applyZoomToCurrentWindow(target);
      const appliedZoom = commandZoomApplier.tracker.getLastApplication()?.appliedZoom
        ?? nextZoom;
      lastAppliedZoom = appliedZoom;
      if (display) {
        statusBar?.update({ display, zoom: appliedZoom });
      } else {
        statusBar?.updateZoom(appliedZoom);
      }

      if (
        display &&
        shouldAnnounceDisplayZoom({
          source: context?.source,
          zoomChanged: previousZoom !== appliedZoom
        })
      ) {
        void showDisplayZoomToast({ display, zoom: appliedZoom });
      }
    }
  };

  const monitor = new WindowMonitor({
    helperClient,
    getConfig: getSmartZoomConfig,
    resolveZoom,
    zoomApplier: statusAwareZoomApplier,
    logger,
    isWindowFocused: () => vscode.window.state.focused
  });

  if (initialConfig.enabled !== false && vscode.window.state.focused) {
    try {
      const detection = await helperClient.getCurrentWindowDisplay();
      const display = toDisplayIdentity(detection);
      const targetZoom = clampZoomLevel(resolveZoom({ display, config: initialConfig }));
      await statusAwareZoomApplier.applyZoomToCurrentWindow(targetZoom, display, {
        source: 'startup'
      });
      monitor.seedCurrentDisplay(detection.display.id);
      initialStatus = {
        display,
        zoom: commandZoomApplier.tracker.getLastApplication()?.appliedZoom ?? targetZoom
      };
    } catch (error) {
      await handleError(error);
    }
  }

  monitor.start();

  statusBar = new SmartZoomStatusBar({
    getStatus: async () => {
      const detection = await helperClient.getCurrentWindowDisplay();
      const display = toDisplayIdentity(detection);
      const configuredZoom = clampZoomLevel(resolveZoom({ display, config: getSmartZoomConfig() }));

      return {
        display,
        zoom: commandZoomApplier.tracker.getLastApplication()?.appliedZoom
          ?? configuredZoom
      };
    },
    onError: handleError
  });

  if (initialStatus) {
    statusBar.update(initialStatus);
  }

  registerCommands({
    context,
    helperClient,
    zoomApplier: statusAwareZoomApplier,
    statusBar,
    getConfig: getSmartZoomConfig,
    logger,
    onError: handleError
  });

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        clearStableHomeTimer();
        return;
      }
      tryRestoreSpaceZoom('focus');
      clearStableHomeTimer();
      stableHomeTimer = setTimeout(() => {
        spaceRestore = noteStableHome(spaceRestore);
        stableHomeTimer = undefined;
      }, 1500);
    }),
    {
      dispose: () => {
        clearStableHomeTimer();
        helperClient.onHelperEvent?.(undefined);
      }
    },
    { dispose: () => monitor.stop() },
    { dispose: () => helperClient.dispose() },
    { dispose: () => disposeDisplayZoomToast() },
    statusBar
  );
  activeMonitor = monitor;
  activeStatusBar = statusBar;
  const version = String(
    (context.extension.packageJSON as { version?: unknown }).version ?? 'unknown'
  );
  logger.info(`Smart Zoom ${version} activated.`);
}

export function deactivate(): void {
  activeMonitor?.stop();
  activeStatusBar?.dispose();
  disposeDisplayZoomToast();
  activeMonitor = undefined;
  activeStatusBar = undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBestEffortTitleHint(): string | undefined {
  const workspaceName = vscode.workspace.name?.trim();
  const editorPath = vscode.window.activeTextEditor?.document.fileName;
  const fileBase = editorPath ? basename(editorPath) : undefined;

  if (fileBase && workspaceName) {
    return `${fileBase} — ${workspaceName}`;
  }

  return fileBase ?? workspaceName;
}
