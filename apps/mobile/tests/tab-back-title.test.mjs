import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { tabBackTitle } from '../lib/tab-back-title.ts';

test('탭에서 연 화면의 iOS 뒤로 글자는 라우트 이름 "(tabs)"가 아니라 지금 탭 이름이다', () => {
  assert.equal(tabBackTitle(undefined), '홈');
  assert.equal(tabBackTitle('index'), '홈');
  assert.equal(tabBackTitle('reading'), '리딩');
  assert.equal(tabBackTitle('challenges'), '챌린지');
  assert.equal(tabBackTitle('profile'), '프로필');
  assert.equal(tabBackTitle('history'), '홈');
});

test('루트 스택의 (tabs) 화면은 지금 탭으로 제목을 정한다', () => {
  const root = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(root, /name="\(tabs\)"[\s\S]{0,200}tabBackTitle\(getFocusedRouteNameFromRoute\(route\)\)/);
});
