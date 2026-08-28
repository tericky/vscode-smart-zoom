import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatDisplayZoomToast,
  formatDisplayZoomToastDetail,
  shouldAnnounceDisplayZoom
} from '../ui/zoomToastMessage';

test('formats display-switch toast with zoom level and percent', () => {
  assert.equal(
    formatDisplayZoomToast({ displayName: 'Studio Display', zoom: 1 }),
    'Smart Zoom · Studio Display · Zoom Level 1 : 120 %'
  );
});

test('falls back to unknown display name', () => {
  assert.equal(
    formatDisplayZoomToast({ zoom: 0 }),
    'Smart Zoom · Unknown display · Zoom Level 0 : 100 %'
  );
});

test('formats resolution detail', () => {
  assert.equal(
    formatDisplayZoomToastDetail({
      displayId: 'a',
      name: 'Studio Display',
      width: 5120,
      height: 2880,
      scaleFactor: 2
    }),
    '5120 × 2880 @ 2x'
  );
});

test('announces auto zoom only when the applied zoom actually changed', () => {
  assert.equal(shouldAnnounceDisplayZoom({ source: 'auto', zoomChanged: true }), true);
  assert.equal(shouldAnnounceDisplayZoom({ source: 'auto', zoomChanged: false }), false);
  assert.equal(shouldAnnounceDisplayZoom({ source: 'startup', zoomChanged: true }), false);
  assert.equal(shouldAnnounceDisplayZoom({ source: 'manual', zoomChanged: true }), false);
});
