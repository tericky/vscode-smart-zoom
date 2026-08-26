import * as vscode from 'vscode';
import { basename } from 'node:path';

import { registerCommands, toDisplayIdentity } from './commands/registerCommands';
import { getAutoZoomConfig } from './config/configStore';
import { resolveZoom } from './display/zoomResolver';
import { JsonLineHelperClient, NativeHelperError } from './helper/helperClient';
import { getHelperPath } from './helper/helperLocator';
import { prepareHelperBinary } from './helper/prepareHelper';
import { Logger } from './log/logger';
import { WindowMonitor } from './monitor/windowMonitor';
import { AutoZoomStatus, AutoZoomStatusBar } from './ui/statusBar';
import { showDisplayZoomToast, disposeDisplayZoomToast } from './ui/zoomToast';
import { CommandZoomApplier } from './zoom/zoomApplier';
import { clampZoomLevel } from './zoom/zoomFormat';

let activeMonitor: WindowMonitor | undefined;
let activeStatusBar: AutoZoomStatusBar | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  context.subscriptions.push(logger);

  const initialConfig = getAutoZoomConfig();
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
  let statusBar: AutoZoomStatusBar | undefined;
  let initialStatus: AutoZoomStatus | undefined;
  let waylandNoticeShown = false;

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
      await commandZoomApplier.applyZoomToCurrentWindow(target);
      const appliedZoom = commandZoomApplier.tracker.getLastApplication()?.appliedZoom
        ?? Math.round(target);
      if (display) {
        statusBar?.update({ display, zoom: appliedZoom });
      } else {
        statusBar?.updateZoom(appliedZoom);
      }

      if (context?.source === 'auto' && display) {
        void showDisplayZoomToast({ display, zoom: appliedZoom });
      }
    }
  };

  const monitor = new WindowMonitor({
    helperClient,
    getConfig: getAutoZoomConfig,
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

  statusBar = new AutoZoomStatusBar({
    getStatus: async () => {
      const detection = await helperClient.getCurrentWindowDisplay();
      const display = toDisplayIdentity(detection);
      const configuredZoom = clampZoomLevel(resolveZoom({ display, config: getAutoZoomConfig() }));

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
    getConfig: getAutoZoomConfig,
    logger,
    onError: handleError
  });

  context.subscriptions.push(
    { dispose: () => monitor.stop() },
    { dispose: () => helperClient.dispose() },
    { dispose: () => disposeDisplayZoomToast() },
    statusBar
  );
  activeMonitor = monitor;
  activeStatusBar = statusBar;
  logger.info('Smart Zoom activated.');
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
