import type { DetectorResult, DisplayIdentity } from './types';

export function toDisplayIdentity(result: DetectorResult): DisplayIdentity {
  return {
    displayId: result.display.id,
    name: result.display.name,
    width: result.display.width,
    height: result.display.height,
    scaleFactor: result.display.scaleFactor
  };
}
