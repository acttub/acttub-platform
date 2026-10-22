import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// 안내 말풍선은 앱 맨 바깥에 그려진다 — 화면을 떠날 때 닫지 않으면 설정·다른 탭 위에 남고,
// 돌아오면 다시 열리며 튄다(10/22 실기기). 떠날 때 닫고, 떠난 뒤 도착한 확인으로는 열지 않는다.
for (const [name, file] of [
  ['대본 탭', 'app/(tabs)/reading.tsx'],
  ['홈', 'app/(tabs)/index.tsx'],
]) {
  test(`${name} 안내는 화면을 떠나면 닫힌다`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /const guideFocused = useRef\(false\);/);
    assert.match(src, /if \(!seen && guideFocused\.current\) setGuideOpen\(true\);/);
    assert.match(src, /guideFocused\.current = true;/);
    assert.match(src, /guideFocused\.current = false;\s*\n\s*setGuideOpen\(false\);/);
  });
}
