import * as vscode from 'vscode';

import type { DisplayIdentity } from '../display/types';
import { formatZoomPercent } from '../zoom/zoomFormat';

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
    this.item.command = 'autoZoom.statusMenu';
    this.item.name = 'Smart Zoom';
    this.item.tooltip = 'Smart Zoom — click to choose zoom size for this display';
    this.item.text = '$(zoom-in) Smart Zoom —%';
    this.item.show();
  }

  public getCachedStatus(): AutoZoomStatus | undefined {
    return this.currentStatus;
  }

  public update(status: AutoZoomStatus): void {
    this.currentStatus = status;
    this.item.text = formatStatusText(status);
    this.item.tooltip = formatStatusTooltip(status);
  }

  public updateZoom(zoom: number): void {
    if (this.currentStatus) {
      this.update({
        ...this.currentStatus,
        zoom
      });
      return;
    }

    this.item.text = `$(zoom-in) Smart Zoom ${formatZoomPercent(zoom)}`;
  }

  public async refresh(): Promise<AutoZoomStatus> {
    const status = await this.getStatus();
    this.update(status);
    return status;
  }

  public async showStatus(): Promise<void> {
    try {
      const status = await this.refresh();
      await vscode.window.showInformationMessage(formatStatusMessage(status));
    } catch (error) {
      await this.onError(error);
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}

export function formatStatusMessage(status: AutoZoomStatus): string {
  return [
    `Display: ${status.display.name ?? 'Unknown'}`,
    `Resolution: ${status.display.width} × ${status.display.height}`,
    `Scale: ${status.display.scaleFactor}x`,
    `Display ID: ${status.display.displayId ?? 'Unknown'}`,
    `Zoom: ${formatZoomPercent(status.zoom)}`
  ].join('\n');
}

function formatStatusText(status: AutoZoomStatus): string {
  const displayLabel = shortDisplayName(status.display.name);
  const zoom = formatZoomPercent(status.zoom);
  if (displayLabel) {
    return `$(zoom-in) ${zoom} · ${displayLabel}`;
  }

  return `$(zoom-in) Smart Zoom ${zoom}`;
}

function formatStatusTooltip(status: AutoZoomStatus): string {
  return [
    formatStatusMessage(status),
    '',
    'Click to open the zoom menu.',
    'The current size is marked with ✓ in the list.'
  ].join('\n');
}

function shortDisplayName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const trimmed = name.trim();
  if (trimmed.length <= 18) {
    return trimmed;
  }

  return `${trimmed.slice(0, 15)}…`;
}
