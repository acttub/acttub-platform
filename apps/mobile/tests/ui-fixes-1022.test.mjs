import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('챌린지 오늘의 대사 안내 줄은 아래 「나도 이 대사 연기하기」 버튼이 있으면 그 버튼을 가리킨다(10/22 피드백)', () => {
  assert.match(read('app/(tabs)/challenges.tsx'), /canPerform\(challenge\) \? 'challenges\.heroGuidePerform' : 'challenges\.heroGuide'/);
  assert.match(read('locales/ko.ts'), /heroGuidePerform: '아래 버튼을 누르면 바로 찍을 수 있어요\.'/);
});

test('버튼 이름은 대괄호 대신 「」로 쓴다 — 대본 상세 빈 화면(10/22 피드백)', () => {
  assert.match(read('locales/ko.ts'), /noSessionsHint: '「연습하기」로 첫 연습을 시작해요\.'/);
});
