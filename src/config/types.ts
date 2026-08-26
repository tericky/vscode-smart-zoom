export interface DisplayProfile {
  name?: string;
  width: number;
  height: number;
  scaleFactor: number;
  zoom: number;
}

export interface ZoomRule {
  width: number;
  height: number;
  scaleFactor: number;
  zoom: number;
}

export interface AutoZoomConfig {
  defaultZoom: number;
  displayProfiles: Record<string, DisplayProfile>;
  zoomRules: ZoomRule[];
}
