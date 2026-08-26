import * as vscode from 'vscode';

import type { DisplayIdentity } from '../display/types';
import { formatDisplayZoomToast, formatDisplayZoomToastDetail } from './zoomToastMessage';

const toastDurationMs = 700;

let hudPanel: vscode.WebviewPanel | undefined;
let hideTimer: NodeJS.Timeout | undefined;
let messageSubscription: vscode.Disposable | undefined;

export async function showDisplayZoomToast(input: {
  display: DisplayIdentity;
  zoom: number;
}): Promise<void> {
  const title = formatDisplayZoomToast({
    displayName: input.display.name,
    zoom: input.zoom
  });
  const detail = formatDisplayZoomToastDetail(input.display);

  const panel = ensureHudPanel();
  panel.title = 'Smart Zoom';
  panel.webview.html = buildHudHtml(title, detail, toastDurationMs);
  panel.reveal(vscode.ViewColumn.Active, true);

  scheduleAutoClose(toastDurationMs + 80);
}

function ensureHudPanel(): vscode.WebviewPanel {
  if (hudPanel) {
    return hudPanel;
  }

  hudPanel = vscode.window.createWebviewPanel(
    'smartZoom.hud',
    'Smart Zoom',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: []
    }
  );

  messageSubscription = hudPanel.webview.onDidReceiveMessage((message: { type?: string }) => {
    if (message?.type === 'done') {
      disposeHudPanel();
    }
  });

  hudPanel.onDidDispose(() => {
    clearHideTimer();
    messageSubscription?.dispose();
    messageSubscription = undefined;
    hudPanel = undefined;
  });

  return hudPanel;
}

function scheduleAutoClose(delayMs: number): void {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    disposeHudPanel();
  }, delayMs);
}

function clearHideTimer(): void {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function disposeHudPanel(): void {
  clearHideTimer();
  const panel = hudPanel;
  hudPanel = undefined;
  messageSubscription?.dispose();
  messageSubscription = undefined;
  panel?.dispose();
}

function buildHudHtml(title: string, detail: string, durationMs: number): string {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  const fadeOutAtMs = Math.max(200, durationMs - 180);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: dark light;
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
    .stage {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 50% 42%, rgba(0, 0, 0, 0.28), transparent 55%),
        rgba(0, 0, 0, 0.18);
      animation: stage-in 180ms ease-out both;
    }
    .card {
      min-width: min(520px, 86vw);
      max-width: 720px;
      padding: 28px 34px;
      border-radius: 18px;
      text-align: center;
      color: #f4f7fb;
      background: linear-gradient(160deg, rgba(28, 34, 44, 0.92), rgba(14, 18, 24, 0.94));
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow:
        0 18px 50px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
      transform-origin: center;
      animation:
        card-in 280ms cubic-bezier(0.2, 0.9, 0.2, 1) both,
        card-out 320ms ease-in ${fadeOutAtMs}ms forwards;
    }
    .eyebrow {
      margin: 0 0 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 600;
      color: rgba(180, 220, 255, 0.86);
    }
    .title {
      margin: 0;
      font-size: clamp(18px, 2.4vw, 26px);
      font-weight: 650;
      line-height: 1.35;
    }
    .detail {
      margin: 12px 0 0;
      font-size: 13px;
      color: rgba(230, 236, 245, 0.72);
    }
    .bar {
      margin: 18px auto 0;
      width: 120px;
      height: 3px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.12);
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #7dd3fc, #38bdf8);
      animation: bar ${durationMs}ms linear both;
    }
    @keyframes stage-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(10px) scale(0.94); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes card-out {
      to { opacity: 0; transform: translateY(-8px) scale(0.97); }
    }
    @keyframes bar {
      from { width: 0%; }
      to { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="card" role="status" aria-live="polite">
      <p class="eyebrow">Display changed</p>
      <p class="title">${safeTitle}</p>
      <p class="detail">${safeDetail}</p>
      <div class="bar"><span></span></div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    setTimeout(() => vscode.postMessage({ type: 'done' }), ${durationMs});
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
