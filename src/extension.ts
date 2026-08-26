import * as vscode from 'vscode';

import { registerCommands, toDisplayIdentity } from './commands/registerCommands';
import { getAutoZoomConfig } from './config/configStore';
import { resolveZoom } from './display/zoomResolver';
import { JsonLineHelperClient, NativeHelperError } from './helper/helperClient';
import { getHelperPath } from './helper/helperLocator';
import { Logger } from './log/logger';
import { WindowMonitor } from './monitor/windowMonitor';
import { AutoZoomStatus, AutoZoomStatusBar } from './ui/statusBar';
import { CommandZoomApplier } from './zoom/zoomApplier';

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
      'Auto Zoom requires window.zoomPerWindow to be enabled. Zoom changes will not be applied.'
    );
  }

  const helperClient = new JsonLineHelperClient(getHelperPath(context));
  const commandZoomApplier = new CommandZoomApplier({ logger });
  let statusBar: AutoZoomStatusBar | undefined;
  let initialStatus: AutoZoomStatus | undefined;
  let waylandNoticeShown = false;

  const handleError = async (error: unknown): Promise<void> => {
    logger.info(`Auto Zoom operation failed: ${formatError(error)}`);

    if (error instanceof NativeHelperError && error.nativeError === 'wayland_unsupported') {
      if (!waylandNoticeShown) {
        waylandNoticeShown = true;
        await vscode.window.showWarningMessage(
          'Auto Zoom cannot detect the current display on Wayland. This platform limitation prevents automatic per-display zoom.'
        );
      }
      return;
    }

    await vscode.window.showErrorMessage(`Auto Zoom failed: ${formatError(error)}`);
  };

  const statusAwareZoomApplier = {
    applyZoomToCurrentWindow: async (target: number): Promise<void> => {
      await commandZoomApplier.applyZoomToCurrentWindow(target);
      const appliedZoom = commandZoomApplier.tracker.getLastApplication()?.appliedZoom
        ?? Math.round(target);
      statusBar?.updateZoom(appliedZoom);
    }
  };

  const monitor = new WindowMonitor({
    helperClient,
    getConfig: getAutoZoomConfig,
    resolveZoom,
    zoomApplier: statusAwareZoomApplier,
    logger
  });

  try {
    const detection = await helperClient.getCurrentWindowDisplay();
    const display = toDisplayIdentity(detection);
    const targetZoom = resolveZoom({ display, config: initialConfig });
    await statusAwareZoomApplier.applyZoomToCurrentWindow(targetZoom);
    initialStatus = {
      display,
      zoom: commandZoomApplier.tracker.getLastApplication()?.appliedZoom ?? Math.round(targetZoom)
    };
  } catch (error) {
    await handleError(error);
  }

  monitor.start();

  statusBar = new AutoZoomStatusBar({
    getStatus: async () => {
      const detection = await helperClient.getCurrentWindowDisplay();
      const display = toDisplayIdentity(detection);
      const configuredZoom = resolveZoom({ display, config: getAutoZoomConfig() });

      return {
        display,
        zoom: commandZoomApplier.tracker.getLastApplication()?.appliedZoom
          ?? Math.round(configuredZoom)
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
    statusBar
  );
  activeMonitor = monitor;
  activeStatusBar = statusBar;
  logger.info('Auto Zoom activated.');
}

export function deactivate(): void {
  activeMonitor?.stop();
  activeStatusBar?.dispose();
  activeMonitor = undefined;
  activeStatusBar = undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
