import * as vscode from 'vscode';

import { saveDisplayConfiguration } from '../config/configStore';
import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity, DetectorResult } from '../display/types';
import { resolveZoom } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';
import type { ZoomApplier } from '../monitor/windowMonitor';
import { AutoZoomStatusBar, formatStatusMessage } from '../ui/statusBar';
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

type StatusMenuAction =
  | { kind: 'zoomDelta'; delta: number }
  | { kind: 'setZoom'; zoom: number }
  | { kind: 'customZoom' }
  | { kind: 'showStatus' }
  | { kind: 'detect' }
  | { kind: 'toggleEnabled' };

interface StatusMenuItem extends vscode.QuickPickItem {
  action: StatusMenuAction;
}

const presetZooms = [-2, -1, 0, 1, 2, 3, 4];

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
    const normalized = Math.round(zoom);
    await saveDisplayConfiguration(display, normalized);
    await zoomApplier.applyZoomToCurrentWindow(normalized);
    statusBar.update({ display, zoom: normalized });
    logger.info(
      `Saved zoom ${formatZoomPercent(normalized)} for display ${display.displayId ?? 'unknown'}.`
    );
  };

  const resolveCurrentDisplayZoom = async (): Promise<{ display: DisplayIdentity; zoom: number }> => {
    const display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
    const zoom = Math.round(resolveZoom({ display, config: getConfig() }));
    return { display, zoom };
  };

  registerCommand(context, 'autoZoom.enable', async () => {
    try {
      await setEnabled(true);
      logger.info('Auto Zoom enabled.');
      await vscode.window.showInformationMessage('Auto Zoom is enabled.');
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.disable', async () => {
    try {
      await setEnabled(false);
      logger.info('Auto Zoom disabled.');
      await vscode.window.showInformationMessage('Auto Zoom is disabled.');
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

  registerCommand(context, 'autoZoom.statusMenu', async () => {
    try {
      const { display, zoom } = await resolveCurrentDisplayZoom();
      statusBar.update({ display, zoom });

      const enabled = getConfig().enabled !== false;
      const picked = await vscode.window.showQuickPick<StatusMenuItem>(
        buildStatusMenuItems({ display, zoom, enabled }),
        {
          title: 'Auto Zoom',
          placeHolder: 'Choose a zoom size for this display',
          matchOnDescription: true,
          matchOnDetail: true
        }
      );

      if (!picked) {
        return;
      }

      switch (picked.action.kind) {
        case 'zoomDelta':
          await applySavedZoom(display, zoom + picked.action.delta);
          break;
        case 'setZoom':
          await applySavedZoom(display, picked.action.zoom);
          break;
        case 'customZoom': {
          const input = await vscode.window.showInputBox({
            title: 'Custom Zoom',
            prompt: 'Enter zoom as a percent (for example 100 or 120%).',
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
        case 'toggleEnabled':
          await setEnabled(!enabled);
          await vscode.window.showInformationMessage(
            `Auto Zoom is now ${!enabled ? 'enabled' : 'disabled'}.`
          );
          break;
      }
    } catch (error) {
      await onError(error);
    }
  });
}

function buildStatusMenuItems(input: {
  display: DisplayIdentity;
  zoom: number;
  enabled: boolean;
}): StatusMenuItem[] {
  const displayName = input.display.name ?? 'Unknown display';
  const items: StatusMenuItem[] = [
    {
      label: '$(zoom-in) Larger',
      description: `${formatZoomPercent(input.zoom)} → ${formatZoomPercent(input.zoom + 1)}`,
      detail: `Save and apply for ${displayName}`,
      action: { kind: 'zoomDelta', delta: 1 }
    },
    {
      label: '$(zoom-out) Smaller',
      description: `${formatZoomPercent(input.zoom)} → ${formatZoomPercent(input.zoom - 1)}`,
      detail: `Save and apply for ${displayName}`,
      action: { kind: 'zoomDelta', delta: -1 }
    },
    {
      label: '$(edit) Custom size…',
      description: `Current ${formatZoomPercent(input.zoom)}`,
      action: { kind: 'customZoom' }
    }
  ];

  for (const preset of presetZooms) {
    const percent = formatZoomPercent(preset);
    items.push({
      label: preset === input.zoom ? `$(check) ${percent}` : percent,
      description: preset === input.zoom ? 'Current size' : undefined,
      detail: `Save and apply for ${displayName}`,
      action: { kind: 'setZoom', zoom: preset }
    });
  }

  items.push(
    {
      label: '$(info) Show details',
      description: displayName,
      action: { kind: 'showStatus' }
    },
    {
      label: '$(search) Detect current display',
      action: { kind: 'detect' }
    },
    {
      label: input.enabled ? '$(circle-slash) Turn off Auto Zoom' : '$(play) Turn on Auto Zoom',
      description: input.enabled ? 'Currently on' : 'Currently off',
      action: { kind: 'toggleEnabled' }
    }
  );

  return items;
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
  if (parseZoomInput(value) === undefined) {
    return 'Enter a percent like 100 or 120%.';
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
