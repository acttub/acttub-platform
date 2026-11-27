import assert from 'node:assert/strict';
import test from 'node:test';

import { notifyPlaybackStart, setPlaybackStartListener } from '../lib/reading/tts/playback-start.ts';

test('reading.playback-start: 듣는 쪽이 있으면 알리고, 없거나 던져도 재생을 막지 않는다', () => {
  notifyPlaybackStart();
  let heard = 0;
  setPlaybackStartListener(() => {
    heard += 1;
  });
  notifyPlaybackStart();
  assert.equal(heard, 1);
  setPlaybackStartListener(() => {
    throw new Error('계측 실패');
  });
  assert.doesNotThrow(() => notifyPlaybackStart());
  setPlaybackStartListener(null);
  notifyPlaybackStart();
  assert.equal(heard, 1);
});
