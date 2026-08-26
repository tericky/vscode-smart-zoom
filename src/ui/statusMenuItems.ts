import type { DisplayIdentity } from '../display/types';
import {
  clampZoomLevel,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  zoomLevelToPercent
} from '../zoom/zoomFormat';

/** Matches vscode.QuickPickItemKind.Separator without importing the runtime. */
export const MENU_SEPARATOR_KIND = -1;

export { clampZoomLevel, MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL };

export type StatusMenuAction =
  | { kind: 'zoomDelta'; delta: number }
  | { kind: 'setZoom'; zoom: number }
  | { kind: 'showStatus' }
  | { kind: 'detect' }
  | { kind: 'clearLearned' }
  | { kind: 'toggleEnabled' };

export interface StatusMenuItem {
  label: string;
  description?: string;
  detail?: string;
  kind?: number;
  action?: StatusMenuAction;
  /** True for the dedicated Reset row (setZoom 0), not the preset 100% row. */
  isResetAction?: boolean;
}

/** Integer zoom levels shown as percents, largest first (~430% … ~23%). */
export const PRESET_ZOOM_LEVELS = [
  8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8
] as const;

export function formatZoomLevelOption(zoomLevel: number): string {
  return `Zoom Level ${zoomLevel} : ${zoomLevelToPercent(zoomLevel)} %`;
}

export function buildStatusMenuItems(input: {
  display: DisplayIdentity;
  zoom: number;
  enabled: boolean;
}): StatusMenuItem[] {
  const displayName = input.display.name ?? 'Unknown display';
  const currentLevelLabel = formatZoomLevelOption(input.zoom);
  const items: StatusMenuItem[] = [
    {
      label: 'Current display',
      kind: MENU_SEPARATOR_KIND
    },
    {
      label: `$(device-desktop) ${displayName}`,
      description: currentLevelLabel,
      detail: `${input.display.width} × ${input.display.height} @ ${input.display.scaleFactor}x`,
      action: { kind: 'showStatus' }
    },
    {
      label: '$(debug-restart) Reset to 100%',
      description: input.zoom === 0
        ? `Already at ${formatZoomLevelOption(0)}`
        : `${currentLevelLabel} → ${formatZoomLevelOption(0)}`,
      detail: 'Save and apply for this display',
      isResetAction: true,
      action: { kind: 'setZoom', zoom: 0 }
    },
    {
      label: 'Zoom size',
      kind: MENU_SEPARATOR_KIND
    }
  ];

  for (const preset of PRESET_ZOOM_LEVELS) {
    const levelLabel = formatZoomLevelOption(preset);
    const isCurrent = preset === input.zoom;
    items.push({
      label: isCurrent ? `$(check) ${levelLabel}` : levelLabel,
      description: isCurrent ? 'Current' : undefined,
      detail: isCurrent
        ? `Currently applied on ${displayName}`
        : `Save and apply for ${displayName}`,
      action: { kind: 'setZoom', zoom: preset }
    });
  }

  const canZoomIn = input.zoom < MAX_ZOOM_LEVEL;
  const canZoomOut = input.zoom > MIN_ZOOM_LEVEL;

  items.push(
    {
      label: 'Adjust',
      kind: MENU_SEPARATOR_KIND
    },
    {
      label: '$(zoom-in) Larger',
      description: canZoomIn
        ? `${currentLevelLabel} → ${formatZoomLevelOption(input.zoom + 1)}`
        : `Already at max (${formatZoomLevelOption(MAX_ZOOM_LEVEL)})`,
      detail: canZoomIn
        ? `Save and apply for ${displayName}`
        : `Maximum is Zoom Level ${MAX_ZOOM_LEVEL}`,
      action: { kind: 'zoomDelta', delta: 1 }
    },
    {
      label: '$(zoom-out) Smaller',
      description: canZoomOut
        ? `${currentLevelLabel} → ${formatZoomLevelOption(input.zoom - 1)}`
        : `Already at min (${formatZoomLevelOption(MIN_ZOOM_LEVEL)})`,
      detail: canZoomOut
        ? `Save and apply for ${displayName}`
        : `Minimum is Zoom Level ${MIN_ZOOM_LEVEL}`,
      action: { kind: 'zoomDelta', delta: -1 }
    },
    {
      label: 'More',
      kind: MENU_SEPARATOR_KIND
    },
    {
      label: '$(search) Detect current display',
      action: { kind: 'detect' }
    },
    {
      label: '$(trash) Clear all learned settings…',
      description: 'Remove display profiles and zoom rules',
      detail: 'Does not change enabled / poll interval defaults',
      action: { kind: 'clearLearned' }
    },
    {
      label: input.enabled ? '$(circle-slash) Turn off Smart Zoom' : '$(play) Turn on Smart Zoom',
      description: input.enabled ? 'Currently on' : 'Currently off',
      action: { kind: 'toggleEnabled' }
    }
  );

  return items;
}

export function findCurrentZoomMenuItem(
  items: readonly StatusMenuItem[],
  zoom: number
): StatusMenuItem | undefined {
  return items.find(
    (item) =>
      item.action?.kind === 'setZoom' &&
      item.action.zoom === zoom &&
      item.isResetAction !== true
  );
}
