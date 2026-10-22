import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('액티 20종: 모든 자세 그림 파일이 있고 MASCOT 에 이름이 붙어 있다(10/22)', () => {
  const src = read('components/ui/mascot.ts');
  const files = [...src.matchAll(/require\('@\/assets\/images\/acty\/([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(files.length, 20);
  for (const f of files) assert.ok(existsSync(new URL(`../assets/images/acty/${f}`, import.meta.url)), f);
});

test('홈 머리 액티는 하루 동안 같은 자세이고 날마다 돌아간다', async () => {
  const { dailyIndex } = await import('../lib/mascot-day.ts');
  const morning = new Date(2026, 9, 22, 8);
  const night = new Date(2026, 9, 22, 23);
  const tomorrow = new Date(2026, 9, 23, 8);
  assert.equal(dailyIndex(6, morning), dailyIndex(6, night));
  assert.equal(dailyIndex(6, tomorrow), (dailyIndex(6, morning) + 1) % 6);
  assert.equal(dailyIndex(0, morning), 0);
  assert.match(read('app/(tabs)/index.tsx'), /MASCOT\[dailyPose\(HOME_POSES\)\]/);
});
