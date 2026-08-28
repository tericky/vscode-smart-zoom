import * as vscode from 'vscode';

import type { DisplayIdentity } from '../display/types';
import {
  formatDisplayZoomToast,
  formatDisplayZoomToastDetail,
  shouldAnnounceDisplayZoom
} from './zoomToastMessage';

export { shouldAnnounceDisplayZoom };

const toastDurationMs = 1500;

let messageDisposable: vscode.Disposable | undefined;

export async function showDisplayZoomToast(input: {
  display: DisplayIdentity;
  zoom: number;
}): Promise<void> {
  const title = formatDisplayZoomToast({
    displayName: input.display.name,
    zoom: input.zoom
  });
  const detail = formatDisplayZoomToastDetail(input.display);

  messageDisposable?.dispose();
  messageDisposable = vscode.window.setStatusBarMessage(
    `${title} · ${detail}`,
    toastDurationMs
  );
}

export function disposeDisplayZoomToast(): void {
  messageDisposable?.dispose();
  messageDisposable = undefined;
}
