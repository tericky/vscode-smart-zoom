import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveZoom } from './zoomResolver';
import type { SmartZoomConfig } from '../config/types';
import type { DisplayIdentity } from './types';

const display: DisplayIdentity = {
  displayId: 'display-1',
  width: 3840,
  height: 2160,
  scaleFactor: 2
};

const baseConfig: SmartZoomConfig = {
  defaultZoom: 0,
  displayProfiles: {},
  zoomRules: []
};

test('uses display profile before resolution rule', () => {
  const zoom = resolveZoom({
    display,
    config: {
      ...baseConfig,
      displayProfiles: {
        'display-1': {
          width: 3840,
          height: 2160,
          scaleFactor: 2,
          zoom: 2
        }
      },
      zoomRules: [
        { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 }
      ]
    }
  });

  assert.strictEqual(zoom, 2);
});

test('falls back to matching resolution rule', () => {
  const zoom = resolveZoom({
    display: {
      ...display,
      displayId: 'unknown-display'
    },
    config: {
      ...baseConfig,
      zoomRules: [
        { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 }
      ]
    }
  });

  assert.strictEqual(zoom, 1);
});

test('returns default zoom when no profile or rule matches', () => {
  const zoom = resolveZoom({
    display,
    config: {
      ...baseConfig,
      defaultZoom: -1
    }
  });

  assert.strictEqual(zoom, -1);
});

test('does not match resolution rules with a different scale factor', () => {
  const zoom = resolveZoom({
    display,
    config: {
      ...baseConfig,
      defaultZoom: 0,
      zoomRules: [
        { width: 3840, height: 2160, scaleFactor: 1, zoom: -1 },
        { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 }
      ]
    }
  });

  assert.strictEqual(zoom, 1);
});
