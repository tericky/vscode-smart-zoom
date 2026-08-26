import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AutoZoomConfig } from '../config/types';
import type { DisplayIdentity } from '../display/types';
import { learnDisplayConfiguration, upsertZoomRule } from '../config/configStore';

const baseConfig: AutoZoomConfig = {
  defaultZoom: 0,
  displayProfiles: {},
  zoomRules: []
};

const display: DisplayIdentity = {
  displayId: 'display-1',
  name: 'Main Display',
  width: 3840,
  height: 2160,
  scaleFactor: 2
};

test('learns display profile and resolution rule', () => {
  const config = learnDisplayConfiguration(baseConfig, display, 1.2);

  assert.deepStrictEqual(config.displayProfiles['display-1'], {
    name: 'Main Display',
    width: 3840,
    height: 2160,
    scaleFactor: 2,
    zoom: 1
  });
  assert.deepStrictEqual(config.zoomRules, [
    { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 }
  ]);
  assert.strictEqual(config.defaultZoom, 0);
});

test('updates an existing display profile and matching resolution rule', () => {
  const config = learnDisplayConfiguration(
    {
      defaultZoom: 0,
      displayProfiles: {
        'display-1': {
          name: 'Old Display',
          width: 3840,
          height: 2160,
          scaleFactor: 2,
          zoom: 1
        }
      },
      zoomRules: [
        { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 },
        { width: 2560, height: 1440, scaleFactor: 1, zoom: -1 }
      ]
    },
    display,
    2
  );

  assert.deepStrictEqual(config.displayProfiles['display-1'], {
    name: 'Main Display',
    width: 3840,
    height: 2160,
    scaleFactor: 2,
    zoom: 2
  });
  assert.deepStrictEqual(config.zoomRules, [
    { width: 3840, height: 2160, scaleFactor: 2, zoom: 2 },
    { width: 2560, height: 1440, scaleFactor: 1, zoom: -1 }
  ]);
});

test('upserts zoom rules by resolution key', () => {
  const rules = upsertZoomRule(
    [
      { width: 3840, height: 2160, scaleFactor: 1, zoom: -1 },
      { width: 3840, height: 2160, scaleFactor: 2, zoom: 1 }
    ],
    display,
    3
  );

  assert.deepStrictEqual(rules, [
    { width: 3840, height: 2160, scaleFactor: 1, zoom: -1 },
    { width: 3840, height: 2160, scaleFactor: 2, zoom: 3 }
  ]);
});

test('requires display id when learning display configuration', () => {
  assert.throws(
    () => learnDisplayConfiguration(baseConfig, { ...display, displayId: undefined }, 1),
    /displayId is required/
  );
});
