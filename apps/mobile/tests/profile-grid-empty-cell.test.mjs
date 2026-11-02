import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 프로필 연습 기록·참여작·저장됨 칸 — 마지막 줄의 빈 자리는 칸 폭만 지키고 칠하지 않는다(10/29: 영상 1개가 3개처럼 보였다).
const src = readFileSync(new URL('../app/(tabs)/profile.tsx', import.meta.url), 'utf8');

test('줄을 채우는 빈 자리는 바탕색이 없다', () => {
  assert.match(src, /cellEmpty: \{ flex: 1 \},/);
  assert.doesNotMatch(src, /cellEmpty: \{[^}]*backgroundColor/);
});

test('연습 카드에는 ⋯ 메뉴(전체 보기·숨기기·삭제)가 있고 삭제는 danger 확인을 거친다', () => {
  assert.match(src, /phLabel="profile_practice_menu"/);
  assert.match(src, /api\.deletePracticeGroup\(group\.root_id\)/);
  assert.match(src, /history\.menuDelete'\), destructive: true/);
});
