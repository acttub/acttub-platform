import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { disposeAudioPlayer } from '../lib/audio-dispose.ts';

test('audio: 재생기를 놓을 때 먼저 멈추고 네이티브까지 바로 놓는다 — remove()만으로는 소리가 계속 난다(SOMA-670)', () => {
  const calls = [];
  const player = { pause: () => calls.push('pause'), remove: () => calls.push('remove'), release: () => calls.push('release') };
  disposeAudioPlayer(player);
  assert.deepEqual(calls, ['pause', 'remove', 'release']);
});

test('audio: 이미 놓은 재생기·null 에도 던지지 않는다', () => {
  const boom = () => {
    throw new Error('released');
  };
  assert.doesNotThrow(() => disposeAudioPlayer({ pause: boom, remove: boom, release: boom }));
  assert.doesNotThrow(() => disposeAudioPlayer(null));
  assert.doesNotThrow(() => disposeAudioPlayer(undefined));
});

test('audio: 리딩 재생기는 remove() 만으로 놓지 않는다', () => {
  for (const file of ['lib/reading/tts/engine.ts', 'app/reading/session.tsx', 'app/reading/diff.tsx', 'components/announcement-poster.tsx']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\b(?:player|current)\??\.remove\??\.?\(\)/, `${file}: disposeAudioPlayer 를 쓴다`);
    assert.match(src, /disposeAudioPlayer/, file);
  }
});
