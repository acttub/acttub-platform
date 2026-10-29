import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const play = readFileSync(new URL('../app/reading/play.tsx', import.meta.url), 'utf8');

test('reading.play: 받아쓰기가 늘어도 대본을 맨 아래로 끌지 않는다(SOMA-913)', () => {
  const sv = play.slice(play.indexOf('ref={scrollRef}'), play.indexOf('ref={scrollRef}') + 400);
  assert.doesNotMatch(sv, /scrollToEnd/);
  assert.match(sv, /scrollTo\(\{ y: Math\.max\(0, dialogueCardY\.current - 12\)/);
});

test('reading.play: 대화 카드 위치를 재서 그 자리에 맞춘다', () => {
  assert.match(play, /onLayout=\{\(e\) => \(dialogueCardY\.current = e\.nativeEvent\.layout\.y\)\}/);
});
