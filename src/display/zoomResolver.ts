import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity } from './types';
import { buildResolutionKey } from './resolutionKey';

export interface ResolveZoomInput {
  display: DisplayIdentity;
  config: AutoZoomConfig;
}

export function resolveZoom(input: ResolveZoomInput): number {
  const { display, config } = input;

  if (display.displayId) {
    const profile = config.displayProfiles[display.displayId];

    if (profile) {
      return profile.zoom;
    }
  }

  const displayResolutionKey = buildResolutionKey(
    display.width,
    display.height,
    display.scaleFactor
  );

  const resolutionRule = config.zoomRules.find((rule) => {
    return buildResolutionKey(rule.width, rule.height, rule.scaleFactor) === displayResolutionKey;
  });

  return resolutionRule?.zoom ?? config.defaultZoom;
}
