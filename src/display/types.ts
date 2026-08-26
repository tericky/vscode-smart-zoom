export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedDisplay {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface DetectorResult {
  window: WindowBounds;
  display: DetectedDisplay;
}

export interface DisplayIdentity {
  displayId?: string;
  name?: string;
  width: number;
  height: number;
  scaleFactor: number;
}
