import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatZoomPercent,
  parseZoomInput,
  percentToZoomLevel,
  zoomLevelToPercent
} from './zoomFormat';

test('maps zoom levels to percentages', () => {
  assert.equal(zoomLevelToPercent(0), 100);
  assert.equal(zoomLevelToPercent(1), 120);
  assert.equal(zoomLevelToPercent(-1), 83);
  assert.equal(formatZoomPercent(2), '144%');
});

test('maps percentages back to nearest zoom level', () => {
  assert.equal(percentToZoomLevel(100), 0);
  assert.equal(percentToZoomLevel(120), 1);
  assert.equal(percentToZoomLevel(80), -1);
});

test('parses percent-oriented user input', () => {
  assert.equal(parseZoomInput('120%'), 1);
  assert.equal(parseZoomInput('100'), 0);
  assert.equal(parseZoomInput('0'), 0);
  assert.equal(parseZoomInput('1'), 1);
  assert.equal(parseZoomInput('2'), 2);
});
