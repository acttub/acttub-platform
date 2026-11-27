import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// index 는 화면 없이 마지막 탭으로 넘기는 길이라 뺀다(SOMA-1120).
const TABS = ['reading', 'coaching', 'community', 'challenges', 'profile', 'history'];

test('탭바는 화면 위에 떠 있어서 탭 화면은 탭바 높이(useTabBarSpace)만큼 아래를 비운다 — 숫자로 적지 않는다(10/22 피드백)', () => {
  const bar = read('components/ui/tab-bar.tsx');
  assert.match(bar, /export function useTabBarSpace\(\): number/);
  // 첫 사용자도 탭바를 숨기지 않는다(SOMA-1120).
  assert.doesNotMatch(bar, /hidden/);
  for (const tab of TABS) {
    const src = read(`app/(tabs)/${tab}.tsx`);
    assert.match(src, /useTabBarSpace\(\)|useTabFloatingAddBottom\(\)/, `${tab} 탭이 탭바 높이를 쓴다`);
    assert.doesNotMatch(src, /paddingBottom: (1[0-4]\d|insets\.bottom \+ 1\d\d)\b/, `${tab} 탭에 숫자로 적은 하단 여백이 없다`);
  }
});

test('첫 사용자 안내는 코칭·대본 리딩 두 길 중 하나를 고르고 「다음」으로 간다 — 챌린지는 첫 연습 뒤(SOMA-827)', () => {
  const intro = read('components/first-use-intro.tsx');
  assert.match(intro, /export type FirstPick = 'coaching' \| 'reading';/);
  assert.doesNotMatch(intro, /home_first_challenge/);
  // pen P1.13·P1.14(SOMA-821) — 고르면 카드 안에 「이렇게 진행돼요」 세 단계가 펼쳐진다.
  assert.match(intro, /firstReadingSteps/);
  assert.match(intro, /firstCoachingSteps/);
});
