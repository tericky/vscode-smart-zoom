import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildResolutionKey } from './resolutionKey';

test('builds a resolution key with scale factor', () => {
  assert.strictEqual(buildResolutionKey(3840, 2160, 2), '3840x2160@2');
});

test('keeps scale factor in the resolution key', () => {
  assert.notStrictEqual(
    buildResolutionKey(3840, 2160, 1),
    buildResolutionKey(3840, 2160, 2)
  );
});
