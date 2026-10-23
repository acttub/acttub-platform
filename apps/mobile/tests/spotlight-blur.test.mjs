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
    assert.match(src, /if \(!seen && guideFocused\.current(?: && !firstTimeRef\.current)?\) setGuideOpen\(true\);/);
    assert.match(src, /guideFocused\.current = true;/);
    assert.match(src, /guideFocused\.current = false;\s*\n\s*setGuideOpen\(false\);/);
  });
}

// 대본 탭은 목록·목소리 띠가 늦게 차서 처음 잰 자리가 위로 어긋났다(10/22 실기기) — 떠 있는 동안 계속 다시 잰다.
test('안내가 떠 있는 동안 비출 자리를 계속 다시 잰다', () => {
  const src = readFileSync(new URL('../components/spotlight-guide.tsx', import.meta.url), 'utf8');
  assert.match(src, /const keep = setInterval\(remeasureTargets, REMEASURE_MS\);/);
  assert.match(src, /clearInterval\(keep\);/);
});
