import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('memory: 프로필에서 들어오면 뒤로 글자가 「← 프로필」, 설정에서 오면 「← 설정」(SOMA-713)', () => {
  // 프로필·설정의 입구는 10/25에 뺐다(memory-screen.test.mjs). 화면의 뒤로 글자 규칙만 남긴다.
  const memory = src('app/memory.tsx');
  assert.match(memory, /from === 'profile' \? 'memory\.backToProfile' : 'memory\.backToSettings'/);
  assert.match(src('locales/ko.ts'), /backToProfile: '← 프로필'/);
  assert.match(src('locales/en.ts'), /backToProfile: '← Profile'/);
});

test('challenge-play: 영상 갈아끼우기는 replaceAsync — replace 는 iOS 에서 주 스레드로 불러와 화면이 멈출 수 있다(SOMA-713)', () => {
  const play = src('app/challenge-play.tsx');
  assert.doesNotMatch(play, /player\.replace\(/);
  assert.match(play, /\.replaceAsync\(source\)/);
  assert.match(play, /player\.replaceAsync\(null\)/);
});
