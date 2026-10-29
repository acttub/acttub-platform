import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 프로필 연습 기록·참여작·저장됨 칸 — 마지막 줄의 빈 자리는 칸 폭만 지키고 칠하지 않는다(10/29: 영상 1개가 3개처럼 보였다).
const src = readFileSync(new URL('../app/(tabs)/profile.tsx', import.meta.url), 'utf8');

test('줄을 채우는 빈 자리는 바탕색이 없다', () => {
  assert.match(src, /cellEmpty: \{ flex: 1 \},/);
  assert.doesNotMatch(src, /cellEmpty: \{[^}]*backgroundColor/);
});
