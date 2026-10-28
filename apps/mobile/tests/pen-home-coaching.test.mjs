import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('첫 사용자 홈은 공통 말풍선·Primary 버튼을 쓰고, 카드는 고르기만 한 뒤 「다음」으로 간다(pen P1.12)', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /<MascotBubble/);
  assert.match(home, /t\('home\.firstQuestion'\)[\s\S]{0,80}t\('home\.firstPickSub'\)/);
  assert.match(home, /<PrimaryButton[\s\S]{0,200}t\('home\.firstContinue'\)/);
  assert.match(home, /disabled=\{!firstPick\}/);
  // 카드를 누르면 바로 탭으로 가지 않는다.
  assert.doesNotMatch(home, /onPress=\{\(\) => router\.push\('\/coaching'\)\}/);
});

test('코칭 탭 입구는 새 연습(목적 → 영상)·말로 코칭·대사 만들기로 이어진다', () => {
  const coaching = read('app/(tabs)/coaching.tsx');
  assert.match(coaching, /pathname: '\/upload'/);
  assert.match(coaching, /router\.push\('\/talk'\)/);
  assert.match(coaching, /<ScriptCocreateEntry/);
  // 서버에 없는 값(몇 번 해 봤는지·줄 태그)은 문구조차 두지 않는다.
  const ko = read('locales/ko.ts');
  const block = ko.slice(ko.indexOf('  coachingTab: {'), ko.indexOf('  },', ko.indexOf('  coachingTab: {')));
  assert.doesNotMatch(block, /번 해 봤어요|감정 기억|'해결'/);
});

test('대본 탭은 큰 제목 머리(공통 부품)와 예시 대본 줄을 둔다', () => {
  const reading = read('app/(tabs)/reading.tsx');
  assert.match(reading, /<NavHeader\s+large/);
  assert.match(reading, /reading\.entrySample/);
  assert.match(reading, /router\.push\('\/reading\/sample'\)/);
});
