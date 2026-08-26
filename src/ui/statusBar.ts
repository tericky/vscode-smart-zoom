import * as vscode from 'vscode';

import type { DisplayIdentity } from '../display/types';

export interface AutoZoomStatus {
  display: DisplayIdentity;
  zoom: number;
}

export interface StatusBarOptions {
  getStatus: () => Promise<AutoZoomStatus>;
  onError: (error: unknown) => void | Promise<void>;
}

export class AutoZoomStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly getStatus: () => Promise<AutoZoomStatus>;
  private readonly onError: (error: unknown) => void | Promise<void>;
  private currentStatus: AutoZoomStatus | undefined;

  public constructor(options: StatusBarOptions) {
    this.getStatus = options.getStatus;
    this.onError = options.onError;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'autoZoom.showStatus';
    this.item.name = 'Auto Zoom';
    this.item.tooltip = 'Show Auto Zoom status';
    this.item.text = 'Zoom —';
    this.item.show();
  }

  public update(status: AutoZoomStatus): void {
    this.currentStatus = status;
    this.item.text = `Zoom ${formatZoom(status.zoom)}`;
  }

  public updateZoom(zoom: number): void {
    this.item.text = `Zoom ${formatZoom(zoom)}`;

    if (this.currentStatus) {
      this.currentStatus = {
        ...this.currentStatus,
        zoom
      };
    }
  }

  public async refresh(): Promise<AutoZoomStatus> {
    const status = await this.getStatus();
    this.update(status);
    return status;
  }

  public async showStatus(): Promise<void> {
    try {
      const status = await this.refresh();
      const displayName = status.display.name ?? 'Unknown';
      const displayId = status.display.displayId ?? 'Unknown';

      await vscode.window.showInformationMessage(
        [
          `Display: ${displayName}`,
          `Resolution: ${status.display.width} × ${status.display.height}`,
          `Display ID: ${displayId}`,
          `Zoom: ${formatZoom(status.zoom)}`
        ].join('\n')
      );
    } catch (error) {
      await this.onError(error);
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}

function formatZoom(zoom: number): string {
  return Number.isInteger(zoom) ? String(zoom) : String(Number(zoom.toFixed(2)));
}
