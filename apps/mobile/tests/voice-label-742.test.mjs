import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('tabs: iOS 하단 탭 바는 좌우 20 여백을 start·end 로 준다(SOMA-742·796)', () => {
  // 탭바 모양은 공통 부품 components/ui/tab-bar 로 옮겼다(SOMA-770). left·right 는 라이브러리 기본 start·end: 0 에 져서 안 먹는다.
  const layout = src('components/ui/tab-bar.tsx');
  const ios = layout.slice(layout.indexOf('return IOS'), layout.indexOf('left: 0'));
  assert.match(ios, /start: 20,\s*end: 20,/);
});
