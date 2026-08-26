import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ZoomTracker } from './zoomTracker';

test('stores and returns a copy of the last applied zoom estimate', () => {
  const tracker = new ZoomTracker();

  tracker.recordAppliedZoom({
    requestedZoom: 0.5,
    appliedZoom: 1,
    exact: false,
    resetBaseline: 0,
    commandCount: 1
  });

  const firstRead = tracker.getLastApplication();
  assert.deepEqual(firstRead, {
    requestedZoom: 0.5,
    appliedZoom: 1,
    exact: false,
    resetBaseline: 0,
    commandCount: 1
  });

  if (firstRead) {
    firstRead.appliedZoom = 3;
  }

  assert.equal(tracker.getLastApplication()?.appliedZoom, 1);
});

test('clears tracked zoom estimate', () => {
  const tracker = new ZoomTracker();

  tracker.recordAppliedZoom({
    requestedZoom: 1,
    appliedZoom: 1,
    exact: true,
    resetBaseline: 0,
    commandCount: 1
  });
  tracker.clear();

  assert.equal(tracker.getLastApplication(), undefined);
});
