import type { DisplayIdentity } from '../display/types';
import { formatZoomLevelOption } from './statusMenuItems';

export function formatDisplayZoomToast(input: {
  displayName?: string;
  zoom: number;
}): string {
  const name = input.displayName?.trim() || 'Unknown display';
  return `Smart Zoom · ${name} · ${formatZoomLevelOption(input.zoom)}`;
}

export function formatDisplayZoomToastDetail(display: DisplayIdentity): string {
  return `${display.width} × ${display.height} @ ${display.scaleFactor}x`;
}

export function shouldAnnounceDisplayZoom(input: {
  source?: 'auto' | 'manual' | 'startup';
  zoomChanged: boolean;
}): boolean {
  return input.source === 'auto' && input.zoomChanged;
}
