import * as vscode from 'vscode';
import { Logger } from './log/logger';

type CommandHandler = () => void | Thenable<void>;

function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  handler: CommandHandler
): void {
  context.subscriptions.push(vscode.commands.registerCommand(command, handler));
}

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  context.subscriptions.push(logger);

  registerCommand(context, 'autoZoom.enable', async () => {
    logger.info('Enable command invoked.');
    await vscode.window.showInformationMessage('Auto Zoom enable command is not implemented yet.');
  });

  registerCommand(context, 'autoZoom.disable', async () => {
    logger.info('Disable command invoked.');
    await vscode.window.showInformationMessage('Auto Zoom disable command is not implemented yet.');
  });

  registerCommand(context, 'autoZoom.detectCurrentDisplay', async () => {
    logger.info('Detect Current Display command invoked.');
    await vscode.window.showInformationMessage('Auto Zoom display detection is not implemented yet.');
  });

  registerCommand(context, 'autoZoom.configureCurrentDisplay', async () => {
    logger.info('Configure Current Display command invoked.');
    await vscode.window.showInformationMessage('Auto Zoom display configuration is not implemented yet.');
  });

  registerCommand(context, 'autoZoom.showStatus', async () => {
    logger.info('Show Status command invoked.');
    logger.show();
    await vscode.window.showInformationMessage('Auto Zoom status is not implemented yet.');
  });
}

export function deactivate(): void {
  // Resources are disposed through ExtensionContext.subscriptions.
}
