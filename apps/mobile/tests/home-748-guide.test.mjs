import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('홈 안내는 첫 연습을 끝낸 뒤 연습 탭·챌린지·프로필 탭 세 단계를 비춘다(pen 첫 연습 끝 홈 · 안내, SOMA-748)', () => {
  const home = src('app/(tabs)/index.tsx');
  const steps = home.slice(home.indexOf('const HOME_STEPS'), home.indexOf('];', home.indexOf('const HOME_STEPS')));
  const targets = [...steps.matchAll(/target: TARGET\.(\w+)/g)].map((m) => m[1]);
  // 홈에서 오늘 할 것 카드를 빼서(게시판 홈) 첫 단계는 하단 바 연습 탭(예전 리딩 탭 이름표)을 비춘다.
  // 리딩 안내도 같은 연습 탭을 비춰 첫 단계에 합쳤다 — 연습 탭은 한 번만 비춘다.
  assert.deepEqual(targets, ['tabReading', 'tabChallenge', 'tabProfile']);
  assert.doesNotMatch(steps, /spotReadingTab/);
  // 첫 사용자 홈(뭐부터 해 볼까요?)에서는 띄우지 않고, 「연습 1회」(SOMA-773)를 한 뒤에만 띄운다.
  // 연습이 쌓인 계정(앱을 다시 깐 기존 사용자)에게는 띄우지 않는다(10/26, lib/returning-account).
  assert.match(home, /guideOpen && overlaysReady && loaded && !firstUser && practiced && !skipsHomeGuide\(practices\.length\)/);
  // 불꽃 축하를 따져 본 뒤·축하가 끝난 뒤에만 띄운다(11/2 QA).
  assert.match(home, /streakCheckedFor === streak && celebrateStreak === null/);
  assert.match(home, /visible=\{guideVisible\}/);
  assert.match(home, /const practiced = \(shownDays\?\.length \?\? 0\) > 0;/);

  const layout = src('app/(tabs)/_layout.tsx');
  for (const key of ['tabReading', 'tabChallenge', 'tabProfile']) assert.match(layout, new RegExp(`useSpotlightTarget\\(TARGET\\.${key}\\)`));

  const ko = src('locales/ko.ts');
  assert.match(ko, /spotFirstDoneBody: '잘했어요\. 다음 연습은 여기 연습 탭에서 해요\. 코칭이랑 리딩 중에 골라서 할 수 있어요\.'/);
  assert.match(ko, /spotChallengeTabBody: '챌린지는 매주 같은 대사로 다른 배우들이랑 찍어 올리는 거예요\.'/);
  assert.match(ko, /spotProfileTabBody: '연습 기록이랑 영상은 프로필에 모아 둘게요\. 그럼 다음에 또 봐요!'/);
});
