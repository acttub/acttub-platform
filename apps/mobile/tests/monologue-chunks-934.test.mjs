import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { monologueChunks } from '../lib/reading/monologue.ts';

// SOMA-934 — 독백은 구간 대사를 10줄씩 말풍선으로 끊고, 10줄을 다 읽으면 다음 말풍선으로 넘어간다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const d = (n) => ({ id: `d${n}`, type: 'dialogue', role: '하윤', text: `대사 ${n}` });
const dir = (n) => ({ id: `x${n}`, type: 'direction', text: `지문 ${n}` });

test('대사 10줄마다 말풍선을 끊고, 남은 줄은 마지막 말풍선에 담는다', () => {
  const lines = Array.from({ length: 25 }, (_, i) => d(i + 1));
  assert.deepEqual(monologueChunks(lines, 0, 24), [
    { start: 0, end: 9 },
    { start: 10, end: 19 },
    { start: 20, end: 24 },
  ]);
});

test('지문은 다음 대사가 든 말풍선에 붙고, 맨 끝 지문은 마지막 말풍선에 남는다', () => {
  // 지문, 대사 1~10, 지문, 대사 11, 지문
  const lines = [dir(0), ...Array.from({ length: 10 }, (_, i) => d(i + 1)), dir(1), d(11), dir(2)];
  assert.deepEqual(monologueChunks(lines, 0, lines.length - 1), [
    { start: 0, end: 10 },
    { start: 11, end: 13 },
  ]);
});

test('구간 안만 나누고, 10줄 이하면 말풍선 하나다', () => {
  const lines = Array.from({ length: 30 }, (_, i) => d(i + 1));
  assert.deepEqual(monologueChunks(lines, 5, 12), [{ start: 5, end: 12 }]);
  assert.deepEqual(monologueChunks(lines, 0, 9), [{ start: 0, end: 9 }]);
});

test('리딩 화면 — 독백은 지금 읽는 줄이 든 말풍선까지만 그리고, 지나간 말풍선은 흐리게 남긴다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /const monoChunks = monologue \? lineChunks : \[\];/);
  assert.match(src, /monoChunks\.filter\(\(c\) => c\.start <= Math\.max\(run\.index, run\.startIndex\)\)/);
  assert.match(src, /styles\.cardPast/);
});

test('구간 고르기 — 독백·일반 대본 모두 첫 연습이어도 처음 10줄로 줄이지 않고 전체를 기본으로 잡는다', () => {
  const src = read('app/reading/range.tsx');
  assert.doesNotMatch(src, /firstPracticeRange\(/);
});

test('리딩 화면 — 일반 대본도 대사 10줄씩 묶어, 묶음이 바뀌는 자리에 「N–M번째 대사」를 두고 지난 묶음 줄은 흐리게 한다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /const lineChunks = monologueChunks\(run\.lines, run\.startIndex, run\.endIndex\);/);
  assert.match(src, /t\('reading\.chunkLabel', \{ from: h\.from, to: h\.to \}\)/);
  assert.match(src, /styles\.pastRowOld/);
  assert.match(read('locales/ko.ts'), /chunkLabel: '\{\{from\}\}–\{\{to\}\}번째 대사'/);
});

test('리딩 화면 — 뒤에 말풍선이 남았으면 아래 주 버튼이 「다음 대사」(마지막만 「끝내기」)이고, 스크롤은 읽는 문장을 늘 같은 높이에 둔다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /const nextMonoChunk = useCallback\(/);
  assert.match(src, /if \(monoNext\) nextMonoChunk\(monoNext\.start\);/);
  assert.match(src, /t\(monoNext \? 'reading\.monologueNextChunk' : monologue \? 'reading\.monologueFinish' : 'reading\.next'\)/);
  assert.match(src, /const target = Math\.max\(0, monoCardY\.current \+ y - MONO_FOLLOW_TOP\);/);
  // 말풍선 안 버튼·새 말풍선 맨 위로 튀는 스크롤은 없앴다.
  assert.doesNotMatch(src, /styles\.monoNextBtn|monoShownStart/);
  assert.match(read('locales/ko.ts'), /monologueNextChunk: '다음 대사'/);
  assert.match(read('locales/en.ts'), /monologueNextChunk: 'Next lines'/);
});

test('리딩 화면 — 독백의 「방금 말한 것」은 스크롤 끝이 아니라 버튼 줄 바로 위에 고정하고 최근 두 줄만 보인다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /\{!monologue && isDialogue && myTurn && sttMode\?\.kind === 'stt' && \(/);
  const scrollEnd = src.indexOf('</ScrollView>', src.indexOf("{!monologue && isDialogue && myTurn"));
  const bar = src.indexOf('styles.monoSaidBar]');
  assert.ok(bar > scrollEnd, '독백 「방금 말한 것」은 스크롤 밖에 있어야 한다');
  assert.match(src, /numberOfLines=\{2\} ellipsizeMode="head"/);
});
