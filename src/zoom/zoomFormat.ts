/**
 * VS Code window zoom uses multiplicative 20% steps:
 * percentage ≈ 100 * 1.2^zoomLevel
 */

export function zoomLevelToPercent(zoomLevel: number): number {
  return Math.round(100 * Math.pow(1.2, zoomLevel));
}

export function percentToZoomLevel(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    throw new Error('Percent must be a positive number.');
  }

  return Math.round(Math.log(percent / 100) / Math.log(1.2));
}

export function formatZoomPercent(zoomLevel: number): string {
  return `${zoomLevelToPercent(zoomLevel)}%`;
}

export function parseZoomInput(raw: string): number | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }

  const asPercent = trimmed.endsWith('%')
    ? Number(trimmed.slice(0, -1).trim())
    : Number(trimmed);

  if (!Number.isFinite(asPercent)) {
    return undefined;
  }

  // Prefer percent UX: 80 / 100 / 120 → zoom levels.
  // Bare integers in the typical percent range map as percent.
  // Values like 0, 1, 2 still work as percent only if written with %;
  // without %, treat |value| <= 8 as zoom level for power users,
  // otherwise as percent.
  if (trimmed.endsWith('%')) {
    return percentToZoomLevel(asPercent);
  }

  if (Math.abs(asPercent) <= 8 && Number.isInteger(asPercent)) {
    return asPercent;
  }

  return percentToZoomLevel(asPercent);
}
