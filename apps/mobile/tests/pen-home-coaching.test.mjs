import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('첫 사용자 홈은 공통 말풍선·Primary 버튼을 쓰고, 카드는 고르기만 한 뒤 「계속하기」로 간다(pen 합친 안)', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /<MascotBubble/);
  assert.match(home, /t\('home\.firstIntro'\)/);
  assert.match(home, /<PrimaryButton[\s\S]{0,200}t\('home\.firstContinue'\) : t\('home\.firstPickNone'\)/);
  assert.match(home, /translateList\('home\.firstCoachingSteps'\)/);
  // 카드를 누르면 바로 탭으로 가지 않는다.
  assert.doesNotMatch(home, /onPress=\{\(\) => router\.push\('\/coaching'\)\}/);
});

test('코칭 탭 「지금 찍어서 코칭 받기」는 찍는 법 → 카메라 → 준비 화면으로 이어진다(next=upload)', () => {
  const guide = read('app/record-guide.tsx');
  assert.match(guide, /params\.next === 'upload'/);
  assert.match(guide, /next: 'upload'/);
  const coaching = read('app/(tabs)/coaching.tsx');
  assert.match(coaching, /pathname: '\/record-guide'/);
  // 서버에 없는 값(몇 번 해 봤는지·줄 태그)은 문구조차 두지 않는다.
  const ko = read('locales/ko.ts');
  const block = ko.slice(ko.indexOf('  coachingTab: {'), ko.indexOf('  },', ko.indexOf('  coachingTab: {')));
  assert.doesNotMatch(block, /번 해 봤어요|감정 기억|'해결'/);
});

test('대본 탭은 큰 제목 머리(공통 부품)와 예시 대본 줄을 둔다', () => {
  const reading = read('app/(tabs)/reading.tsx');
  assert.match(reading, /<LargeTitleHeader/);
  assert.match(reading, /t\('reading\.entrySample'\)/);
  assert.match(reading, /pathname: '\/reading\/new', params: \{ sample: '1' \}/);
});
