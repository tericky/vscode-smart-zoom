import * as vscode from 'vscode';

import { clearLearnedConfiguration, saveDisplayConfiguration } from '../config/configStore';
import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity, DetectorResult } from '../display/types';
import { resolveZoom } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';
import type { ZoomApplier } from '../monitor/windowMonitor';
import { AutoZoomStatusBar, formatStatusMessage } from '../ui/statusBar';
import { showStatusMenu } from '../ui/statusMenu';
import {
  clampZoomLevel,
  formatZoomLevelOption,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL
} from '../ui/statusMenuItems';
import {
  formatZoomPercent,
  parseZoomInput,
  zoomLevelToPercent
} from '../zoom/zoomFormat';

export interface CommandLogger {
  info(message: string): void;
  show(): void;
}

export interface RegisterCommandsOptions {
  context: vscode.ExtensionContext;
  helperClient: HelperClient;
  zoomApplier: ZoomApplier;
  statusBar: AutoZoomStatusBar;
  getConfig: () => AutoZoomConfig;
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

  const applySavedZoom = async (display: DisplayIdentity, zoom: number): Promise<void> => {
    const normalized = clampZoomLevel(zoom);
    await saveDisplayConfiguration(display, normalized);
    await zoomApplier.applyZoomToCurrentWindow(normalized);
    statusBar.update({ display, zoom: normalized });
    logger.info(
      `Saved zoom ${formatZoomPercent(normalized)} for display ${display.displayId ?? 'unknown'}.`
    );
  };

  const applyZoomWithoutLearning = async (
    display: DisplayIdentity,
    zoom: number
  ): Promise<void> => {
    const normalized = clampZoomLevel(zoom);
    await zoomApplier.applyZoomToCurrentWindow(normalized);
    statusBar.update({ display, zoom: normalized });
  };

  const resolveCurrentDisplayZoom = async (): Promise<{ display: DisplayIdentity; zoom: number }> => {
    const display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
    const zoom = clampZoomLevel(resolveZoom({ display, config: getConfig() }));
    return { display, zoom };
  };

  registerCommand(context, 'autoZoom.enable', async () => {
    try {
      await setEnabled(true);
      logger.info('Smart Zoom enabled.');
      await vscode.window.showInformationMessage('Smart Zoom is enabled.');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.disable', async () => {
    try {
      await setEnabled(false);
      logger.info('Smart Zoom disabled.');
      await vscode.window.showInformationMessage('Smart Zoom is disabled.');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.detectCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      statusBar.update({ display, zoom });
      await vscode.window.showInformationMessage(formatStatusMessage({ display, zoom }));
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.configureCurrentDisplay', async () => {
    try {
      const { display, zoom: currentZoom } = await resolveCurrentDisplayZoom();
      const input = await vscode.window.showInputBox({
        title: 'Configure Current Display',
        prompt: 'Enter zoom as a percent (for example 100 or 120%).',
        value: String(zoomLevelToPercent(currentZoom)),
        placeHolder: '100',
        validateInput: validateZoomInput
      });

      if (input === undefined) {
        return;
      }

      const zoom = parseZoomInput(input);
      if (zoom === undefined) {
        await vscode.window.showErrorMessage('Enter a valid zoom percent.');
        return;
      }

      await applySavedZoom(display, zoom);
      await vscode.window.showInformationMessage(
        `${formatZoomPercent(zoom)} was saved and applied for this display.`
      );
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.zoomInCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      await applySavedZoom(display, zoom + 1);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.zoomOutCurrentDisplay', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      await applySavedZoom(display, zoom - 1);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.showStatus', async () => {
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

    if (display) {
      await applyZoomWithoutLearning(display, 0);
    }

    await vscode.window.showInformationMessage(
      'Cleared learned settings and applied Zoom Level 0 : 100 % to this window.'
    );
  };

  registerCommand(context, 'autoZoom.clearAllSettings', async () => {
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

  registerCommand(context, 'autoZoom.statusMenu', async () => {
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
          await applySavedZoom(display, nextZoom);
          break;
        }
        case 'setZoom':
          await applySavedZoom(display, picked.action.zoom);
          break;
        case 'customZoom': {
          const input = await vscode.window.showInputBox({
            title: 'Custom Zoom',
            prompt: `Enter zoom as a percent (for example 100 or 120%). Range: Zoom Level ${MIN_ZOOM_LEVEL}…${MAX_ZOOM_LEVEL}.`,
            value: String(zoomLevelToPercent(zoom)),
            placeHolder: '100',
            validateInput: validateZoomInput
          });
          if (input === undefined) {
            return;
          }
          const nextZoom = parseZoomInput(input);
          if (nextZoom === undefined) {
            await vscode.window.showErrorMessage('Enter a valid zoom percent.');
            return;
          }
          await applySavedZoom(display, nextZoom);
          break;
        }
        case 'showStatus':
          logger.show();
          await vscode.window.showInformationMessage(formatStatusMessage({ display, zoom }));
          break;
        case 'detect':
          await vscode.commands.executeCommand('autoZoom.detectCurrentDisplay');
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
    .getConfiguration('autoZoom')
    .update('enabled', enabled, vscode.ConfigurationTarget.Global);
}

function validateZoomInput(value: string): string | undefined {
  const zoom = parseZoomInput(value);
  if (zoom === undefined) {
    return 'Enter a percent like 100 or 120%.';
  }

  if (zoom < MIN_ZOOM_LEVEL || zoom > MAX_ZOOM_LEVEL) {
    return `Zoom must map to Zoom Level ${MIN_ZOOM_LEVEL}…${MAX_ZOOM_LEVEL}.`;
  }

  return undefined;
}

export function toDisplayIdentity(result: DetectorResult): DisplayIdentity {
  return {
    displayId: result.display.id,
    name: result.display.name,
    width: result.display.width,
    height: result.display.height,
    scaleFactor: result.display.scaleFactor
  };
}
