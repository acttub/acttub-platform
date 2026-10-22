import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('챌린지 탭: 첫 참여 전에는 고르기 두 줄 + 「다음」, 이번 주 대사 카드 아래에 파란 「나도 이 대사 연기하기」가 있다(pen C1.13·C1.16)', () => {
  const src = read('app/(tabs)/challenges.tsx');
  assert.match(src, /selectMode/);
  assert.match(src, /challenges\.firstNext/);
  assert.match(src, /canPerform\(featured\) && <PrimaryButton label=\{t\('challenges\.performCta'\)\}/);
  assert.match(read('locales/ko.ts'), /heroGuidePerform: '아래 버튼을 누르면 바로 찍을 수 있어요\.'/);
});

test('버튼 이름은 대괄호 대신 「」로 쓴다 — 대본 상세 빈 화면(10/22 피드백)', () => {
  assert.match(read('locales/ko.ts'), /noSessionsHint: '「연습하기」로 첫 연습을 시작해요\.'/);
});
