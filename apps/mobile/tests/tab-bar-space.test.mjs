import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// 연습 탭(app/(tabs)/practice)은 리딩·코칭 쪽 화면을 그대로 그리므로 그 두 화면을 본다.
const TAB_SCREENS = [
  'app/(tabs)/index.tsx',
  'components/practice/reading-pane.tsx',
  'components/practice/coaching-pane.tsx',
  'app/(tabs)/challenges.tsx',
  'app/(tabs)/community.tsx',
  'app/(tabs)/profile.tsx',
  'app/(tabs)/history.tsx',
];

test('탭바는 화면 위에 떠 있어서 탭 화면은 탭바 높이(useTabBarSpace)만큼 아래를 비운다 — 숫자로 적지 않는다(10/22 피드백)', () => {
  const bar = read('components/ui/tab-bar.tsx');
  assert.match(bar, /export function useTabBarSpace\(\): number/);
  // 첫 사용자도 탭바를 숨기지 않는다(SOMA-1120부터).
  assert.doesNotMatch(bar, /hidden/);
  for (const file of TAB_SCREENS) {
    const src = read(file);
    assert.match(src, /useTabBarSpace\(\)|useTabFloatingAddBottom\(\)/, `${file} 이 탭바 높이를 쓴다`);
    assert.doesNotMatch(src, /paddingBottom: (1[0-4]\d|insets\.bottom \+ 1\d\d)\b/, `${file} 에 숫자로 적은 하단 여백이 없다`);
  }
});

test('첫 사용자 홈은 코칭·대본 리딩 두 길 중 하나를 고르고 「다음」으로 간다 — 챌린지는 첫 연습 뒤(SOMA-827)', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /type FirstPick = PracticeMode;/);
  assert.doesNotMatch(home, /home_first_challenge/);
  // pen P1.13·P1.14(SOMA-821) — 고르면 카드 안에 「이렇게 진행돼요」 세 단계가 펼쳐진다.
  assert.match(home, /firstReadingSteps/);
  assert.match(home, /firstCoachingSteps/);
});
