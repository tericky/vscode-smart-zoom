import * as vscode from 'vscode';

import { saveDisplayConfiguration } from '../config/configStore';
import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity, DetectorResult } from '../display/types';
import { resolveZoom } from '../display/zoomResolver';
import type { HelperClient } from '../helper/helperClient';
import type { ZoomApplier } from '../monitor/windowMonitor';
import type { AutoZoomStatusBar } from '../ui/statusBar';

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
      const display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
      const zoom = resolveZoom({ display, config: getConfig() });
      statusBar.update({ display, zoom });

      await vscode.window.showInformationMessage(
        [
          `Display: ${display.name ?? 'Unknown'}`,
          `Resolution: ${display.width} × ${display.height}`,
          `Display ID: ${display.displayId ?? 'Unknown'}`
        ].join('\n')
      );
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.configureCurrentDisplay', async () => {
    try {
      const display = toDisplayIdentity(await helperClient.getCurrentWindowDisplay());
      const currentZoom = resolveZoom({ display, config: getConfig() });
      const input = await vscode.window.showInputBox({
        title: 'Configure Current Display',
        prompt: 'Enter a zoom level. Decimal values will be rounded to an integer.',
        value: String(currentZoom),
        validateInput: validateZoomInput
      });

      if (input === undefined) {
        return;
      }

      const zoom = Math.round(Number(input.trim()));
      await saveDisplayConfiguration(display, zoom);
      await zoomApplier.applyZoomToCurrentWindow(zoom);
      statusBar.update({ display, zoom });
      logger.info(`Saved zoom ${zoom} for display ${display.displayId ?? 'unknown'}.`);
      await vscode.window.showInformationMessage(`Zoom ${zoom} was saved and applied.`);
    } catch (error) {
      await onError(error);
    }
  });

  registerCommand(context, 'autoZoom.showStatus', async () => {
    logger.show();
    await statusBar.showStatus();
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
  const parsed = Number(value.trim());

  if (value.trim().length === 0 || !Number.isFinite(parsed)) {
    return 'Enter a valid numeric zoom level.';
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
