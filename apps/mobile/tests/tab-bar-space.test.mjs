import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TABS = ['index', 'coaching', 'reading', 'challenges', 'profile', 'history'];

test('탭바는 화면 위에 떠 있어서 탭 화면은 탭바 높이(useTabBarSpace)만큼 아래를 비운다 — 숫자로 적지 않는다(10/22 피드백)', () => {
  const bar = read('components/ui/tab-bar.tsx');
  assert.match(bar, /export function useTabBarSpace\(\): number/);
  assert.match(bar, /if \(firstTime\) return insets\.bottom;/, '탭바를 숨길 때는 홈 표시줄만 비운다');
  for (const tab of TABS) {
    const src = read(`app/(tabs)/${tab}.tsx`);
    assert.match(src, /useTabBarSpace\(\)/, `${tab} 탭이 탭바 높이를 쓴다`);
    assert.doesNotMatch(src, /paddingBottom: (1[0-4]\d|insets\.bottom \+ 1\d\d)\b/, `${tab} 탭에 숫자로 적은 하단 여백이 없다`);
  }
});

test('첫 사용자 홈은 코칭·대본 리딩·챌린지 세 길 중 하나를 고르고 「다음」으로 간다(pen P1.12)', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /type FirstPick = 'coaching' \| 'reading' \| 'challenge';/);
  assert.match(home, /home_first_challenge/);
  // pen P1.13·P1.14(SOMA-821) — 고르면 카드 안에 「이렇게 진행돼요」 세 단계가 펼쳐진다.
  assert.match(home, /firstReadingSteps/);
  assert.match(home, /firstCoachingSteps/);
});
