import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel('Smart Zoom');
  }

  info(message: string): void {
    this.output.appendLine(`[info] ${message}`);
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }
}
