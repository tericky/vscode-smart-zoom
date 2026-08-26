import * as vscode from 'vscode';

import { clearLearnedConfiguration, saveDisplayConfiguration } from '../config/configStore';
import type { SmartZoomConfig } from '../config/types';
import { toDisplayIdentity } from '../display/identity';
import type { DisplayIdentity } from '../display/types';
import { resolveZoom } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';
import type { ZoomApplier } from '../monitor/windowMonitor';
import { SmartZoomStatusBar, formatStatusMessage } from '../ui/statusBar';
import { showStatusMenu } from '../ui/statusMenu';
import {
  clampZoomLevel,
  formatZoomLevelOption,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL
} from '../ui/statusMenuItems';
import { formatZoomPercent } from '../zoom/zoomFormat';

export { toDisplayIdentity } from '../display/identity';

export interface CommandLogger {
  info(message: string): void;
  show(): void;
}

export interface RegisterCommandsOptions {
  context: vscode.ExtensionContext;
  helperClient: HelperClient;
  zoomApplier: ZoomApplier;
  statusBar: SmartZoomStatusBar;
  getConfig: () => SmartZoomConfig;
  logger: CommandLogger;
  onError: (error: unknown) => void | Promise<void>;
}

type CommandHandler = () => void | Thenable<void>;

export function registerCommands(options: RegisterCommandsOptions): void {
  const {
    context,
    helperClient,
    zoomApplier,
    statusBar,
    getConfig,
    logger,
    onError
  } = options;

  const applyZoom = async (
    display: DisplayIdentity,
    zoom: number,
    learn: boolean
  ): Promise<void> => {
    const normalized = clampZoomLevel(zoom);
    await zoomApplier.applyZoomToCurrentWindow(normalized);
    if (learn) {
      await saveDisplayConfiguration(display, normalized);
      logger.info(
        `Saved zoom ${formatZoomPercent(normalized)} for display ${display.displayId ?? 'unknown'}.`
      );
    }
    statusBar.update({ display, zoom: normalized });
  };

  const resolveCurrentDisplayZoom = async (): Promise<{ display: DisplayIdentity; zoom: number }> => {
    const display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
    const zoom = clampZoomLevel(resolveZoom({ display, config: getConfig() }));
    return { display, zoom };
  };

  registerCommand(context, 'smartZoom.enable', async () => {
    try {
      await setEnabled(true);
      logger.info('Smart Zoom enabled.');
      await vscode.window.showInformationMessage('Smart Zoom is enabled.');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.disable', async () => {
    try {
      await setEnabled(false);
      logger.info('Smart Zoom disabled.');
      await vscode.window.showInformationMessage('Smart Zoom is disabled.');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.detectCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      statusBar.update({ display, zoom });
      await vscode.window.showInformationMessage(formatStatusMessage({ display, zoom }));
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.configureCurrentDisplay', async () => {
    try {
      await vscode.commands.executeCommand('smartZoom.statusMenu');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.zoomInCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      await applyZoom(display, zoom + 1, true);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.zoomOutCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      await applyZoom(display, zoom - 1, true);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.showStatus', async () => {
    logger.show();
    await statusBar.showStatus();
  });

  const clearAllLearnedSettings = async (
    display?: DisplayIdentity
  ): Promise<void> => {
    const confirmed = await vscode.window.showWarningMessage(
      'Clear all learned Smart Zoom settings? This removes saved display profiles and zoom rules, then applies Zoom Level 0 (100%) to the current window without re-saving a profile.',
      { modal: true },
      'Clear'
    );
    if (confirmed !== 'Clear') {
      return;
    }

    await clearLearnedConfiguration();
    logger.info('Cleared all learned Smart Zoom display profiles and zoom rules.');

    let appliedReset = false;
    if (display) {
      try {
        await applyZoom(display, 0, false);
        appliedReset = true;
      } catch (error) {
        logger.info(`Cleared settings but could not reset zoom: ${formatError(error)}`);
      }
    }

    await vscode.window.showInformationMessage(
      appliedReset
        ? 'Cleared learned settings and applied Zoom Level 0 : 100 % to this window.'
        : 'Cleared learned settings. Could not apply Zoom Level 0 to this window.'
    );
  };

  registerCommand(context, 'smartZoom.clearAllSettings', async () => {
    try {
      let display: DisplayIdentity | undefined;
      try {
        display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
      } catch {
        display = undefined;
      }
      await clearAllLearnedSettings(display);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'smartZoom.statusMenu', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      statusBar.update({ display, zoom });

      const enabled = getConfig().enabled !== false;
      const picked = await showStatusMenu({ display, zoom, enabled });
      if (!picked?.action) {
        return;
      }

      switch (picked.action.kind) {
        case 'zoomDelta': {
          const nextZoom = clampZoomLevel(zoom + picked.action.delta);
          if (nextZoom === zoom) {
            await vscode.window.showInformationMessage(
              picked.action.delta > 0
                ? `Already at max (${formatZoomLevelOption(MAX_ZOOM_LEVEL)}).`
                : `Already at min (${formatZoomLevelOption(MIN_ZOOM_LEVEL)}).`
            );
            break;
          }
          await applyZoom(display, nextZoom, true);
          break;
        }
        case 'setZoom':
          await applyZoom(display, picked.action.zoom, true);
          break;
        case 'showStatus':
          logger.show();
          await vscode.window.showInformationMessage(formatStatusMessage({ display, zoom }));
          break;
        case 'detect':
          await vscode.commands.executeCommand('smartZoom.detectCurrentDisplay');
          break;
        case 'clearLearned':
          await clearAllLearnedSettings(display);
          break;
        case 'toggleEnabled':
          await setEnabled(!enabled);
          await vscode.window.showInformationMessage(
            `Smart Zoom is now ${!enabled ? 'enabled' : 'disabled'}.`
          );
          break;
      }
    } catch (error) {
      await onError(error);
    }
  });
}

function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  handler: CommandHandler
): void {
  context.subscriptions.push(vscode.commands.registerCommand(command, handler));
}

async function setEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration('smartZoom')
    .update('enabled', enabled, vscode.ConfigurationTarget.Global);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
