export interface TrackedZoomApplication {
  requestedZoom: number;
  appliedZoom: number;
  exact: boolean;
  resetBaseline: number;
  commandCount: number;
}

export class ZoomTracker {
  private lastApplication: TrackedZoomApplication | undefined;

  public recordAppliedZoom(application: TrackedZoomApplication): void {
    this.lastApplication = { ...application };
  }

  public getLastApplication(): TrackedZoomApplication | undefined {
    return this.lastApplication ? { ...this.lastApplication } : undefined;
  }

  public clear(): void {
    this.lastApplication = undefined;
  }
}
