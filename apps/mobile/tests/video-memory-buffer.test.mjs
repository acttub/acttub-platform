import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

globalThis.__videoMemory = { os: 'android' };
stubModules({ 'react-native': 'export const Platform = { get OS() { return globalThis.__videoMemory.os; } };' });
const { limitVideoBuffer, sourceWhileFocused } = await import('../lib/video-memory.ts');

test('안드로이드에서만 영상 버퍼를 줄인다', () => {
  const android = { bufferOptions: {} };
  limitVideoBuffer(android);
  assert.deepEqual(android.bufferOptions, { preferredForwardBufferDuration: 10, minBufferForPlayback: 2, maxBufferBytes: 10_485_760 });

  globalThis.__videoMemory.os = 'ios';
  const ios = { bufferOptions: { untouched: true } };
  limitVideoBuffer(ios);
  assert.deepEqual(ios.bufferOptions, { untouched: true });
});

test('화면이 보일 때만 영상 소스를 건다', () => {
  assert.equal(sourceWhileFocused('file:///a.mp4', true), 'file:///a.mp4');
  assert.equal(sourceWhileFocused('file:///a.mp4', false), null);
});
