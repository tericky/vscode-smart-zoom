export function buildResolutionKey(width: number, height: number, scaleFactor: number): string {
  return `${width}x${height}@${scaleFactor}`;
}
