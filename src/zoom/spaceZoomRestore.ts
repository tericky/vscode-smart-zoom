export interface SpaceRestoreState {
  /** Cursor-only. VS Code does not reset per-window zoom on Spaces. */
  enabled: boolean;
  away: boolean;
  restored: boolean;
}

export function isCursorHost(appName: string): boolean {
  return appName.trim().toLowerCase().includes('cursor');
}

export function createSpaceRestoreState(appName: string): SpaceRestoreState {
  return {
    enabled: isCursorHost(appName),
    away: false,
    restored: false
  };
}

export function noteWindowAway(state: SpaceRestoreState): SpaceRestoreState {
  if (!state.enabled) {
    return state;
  }

  return {
    ...state,
    away: true,
    restored: false
  };
}

export function noteWindowBack(
  state: SpaceRestoreState
): { state: SpaceRestoreState; shouldRestore: boolean } {
  if (!state.enabled || !state.away || state.restored) {
    return { state, shouldRestore: false };
  }

  return {
    state: {
      ...state,
      restored: true
    },
    shouldRestore: true
  };
}

export function noteStableHome(state: SpaceRestoreState): SpaceRestoreState {
  if (!state.enabled) {
    return state;
  }

  return {
    ...state,
    away: false,
    restored: false
  };
}

/**
 * During a Space swipe the helper can briefly resolve an unmatched display
 * (zoom 0). Skip that only while the window is away. Normal moves onto an
 * unconfigured display must still apply defaultZoom 0 / 100%.
 */
export function shouldSkipSpuriousAutoZoomZero(input: {
  source?: 'auto' | 'manual' | 'startup';
  nextZoom: number;
  lastAppliedZoom?: number;
  spaceAway: boolean;
}): boolean {
  return (
    input.source === 'auto' &&
    input.nextZoom === 0 &&
    input.spaceAway &&
    input.lastAppliedZoom !== undefined &&
    input.lastAppliedZoom !== 0
  );
}
