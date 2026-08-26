import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDisplayZoomToast, formatDisplayZoomToastDetail } from '../ui/zoomToastMessage';

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
