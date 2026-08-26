import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildStatusMenuItems,
  clampZoomLevel,
  findCurrentZoomMenuItem,
  formatZoomLevelOption,
  MAX_ZOOM_LEVEL,
  MENU_SEPARATOR_KIND,
  MIN_ZOOM_LEVEL,
  PRESET_ZOOM_LEVELS
} from '../ui/statusMenuItems';

const display = {
  displayId: 'display-a',
  name: 'Studio Display',
  width: 5120,
  height: 2880,
  scaleFactor: 2
};

test('formatZoomLevelOption uses Zoom Level N : XXX %', () => {
  assert.equal(formatZoomLevelOption(1), 'Zoom Level 1 : 120 %');
  assert.equal(formatZoomLevelOption(0), 'Zoom Level 0 : 100 %');
  assert.equal(formatZoomLevelOption(-1), 'Zoom Level -1 : 83 %');
});

test('clampZoomLevel respects ±8 bounds', () => {
  assert.equal(clampZoomLevel(9), MAX_ZOOM_LEVEL);
  assert.equal(clampZoomLevel(-9), MIN_ZOOM_LEVEL);
  assert.equal(clampZoomLevel(2.4), 2);
});

test('lists reset and every preset percent with current marked', () => {
  const items = buildStatusMenuItems({ display, zoom: 2, enabled: true });
  const reset = items.find((item) => item.isResetAction === true);
  assert.ok(reset);
  assert.match(reset.label, /Reset to 100%/);
  assert.equal(
    reset.description,
    `${formatZoomLevelOption(2)} → ${formatZoomLevelOption(0)}`
  );

  const currentDisplay = items.find((item) => item.action?.kind === 'showStatus');
  assert.equal(currentDisplay?.description, formatZoomLevelOption(2));

  for (const level of PRESET_ZOOM_LEVELS) {
    const item = findCurrentZoomMenuItem(items, level);
    assert.ok(item, `missing preset ${level}`);
    if (level === 2) {
      assert.equal(item.label, `$(check) ${formatZoomLevelOption(2)}`);
      assert.equal(item.description, 'Current');
    } else {
      assert.equal(item.label, formatZoomLevelOption(level));
      assert.equal(item.description, undefined);
    }
  }
});

test('findCurrentZoomMenuItem skips the reset row at 100%', () => {
  const items = buildStatusMenuItems({ display, zoom: 0, enabled: false });
  const current = findCurrentZoomMenuItem(items, 0);
  assert.ok(current);
  assert.equal(current.isResetAction, undefined);
  assert.equal(current.description, 'Current');
  assert.deepEqual(current.action, { kind: 'setZoom', zoom: 0 });
});

test('includes separators and secondary actions', () => {
  const items = buildStatusMenuItems({ display, zoom: 0, enabled: true });
  assert.ok(items.some((item) => item.kind === MENU_SEPARATOR_KIND && item.label === 'Zoom size'));
  assert.ok(items.some((item) => item.action?.kind === 'zoomDelta' && item.action.delta === 1));
  assert.ok(items.some((item) => item.action?.kind === 'customZoom'));
  assert.ok(items.some((item) => item.action?.kind === 'clearLearned'));
  assert.ok(items.some((item) => item.action?.kind === 'toggleEnabled'));
  const custom = items.find((item) => item.action?.kind === 'customZoom');
  assert.equal(custom?.description, `Current ${formatZoomLevelOption(0)}`);
  const reset = items.find((item) => item.isResetAction === true);
  assert.equal(reset?.description, `Already at ${formatZoomLevelOption(0)}`);
});
