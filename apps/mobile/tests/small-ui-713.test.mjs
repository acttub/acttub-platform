import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('challenge-play: 영상 갈아끼우기는 replaceAsync — replace 는 iOS 에서 주 스레드로 불러와 화면이 멈출 수 있다(SOMA-713)', () => {
  const play = src('app/challenge-play.tsx');
  assert.doesNotMatch(play, /player\.replace\(/);
  assert.match(play, /\.replaceAsync\(source\)/);
  assert.match(play, /player\.replaceAsync\(null\)/);
});
