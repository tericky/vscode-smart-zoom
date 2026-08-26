import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSpaceRestoreState,
  isCursorHost,
  noteStableHome,
  noteWindowAway,
  noteWindowBack
} from './spaceZoomRestore';

test('detects Cursor without matching Visual Studio Code', () => {
  assert.equal(isCursorHost('Cursor'), true);
  assert.equal(isCursorHost('Cursor Nightly'), true);
  assert.equal(isCursorHost('Visual Studio Code'), false);
  assert.equal(isCursorHost('VSCodium'), false);
});

test('VS Code host never restores on Space visibility changes', () => {
  let state = createSpaceRestoreState('Visual Studio Code');
  state = noteWindowAway(state);
  const back = noteWindowBack(state);

  assert.equal(back.shouldRestore, false);
  assert.equal(back.state.away, false);
});

test('Cursor restores once when a hidden window becomes visible', () => {
  let state = createSpaceRestoreState('Cursor');
  state = noteWindowAway(state);
  const first = noteWindowBack(state);
  const second = noteWindowBack(first.state);

  assert.equal(first.shouldRestore, true);
  assert.equal(second.shouldRestore, false);
});

test('focus after a missed visible event still restores once', () => {
  let state = createSpaceRestoreState('Cursor');
  state = noteWindowAway(state);
  const focused = noteWindowBack(state);

  assert.equal(focused.shouldRestore, true);
});

test('focus without leaving a Space does not restore', () => {
  const state = createSpaceRestoreState('Cursor');
  const focused = noteWindowBack(state);

  assert.equal(focused.shouldRestore, false);
});

test('stable home allows the next Space trip to restore again', () => {
  let state = createSpaceRestoreState('Cursor');
  state = noteWindowAway(state);
  state = noteWindowBack(state).state;
  state = noteStableHome(state);
  state = noteWindowAway(state);
  const nextTrip = noteWindowBack(state);

  assert.equal(nextTrip.shouldRestore, true);
});
