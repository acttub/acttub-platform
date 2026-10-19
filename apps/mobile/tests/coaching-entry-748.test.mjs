import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { coachingEntry } from '../lib/practice/coaching-entry.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const round = (id, at, note = null) => ({
  id,
  ordinal: 1,
  created_at: at,
  stage: 'done',
  message_count: 4,
  note,
  conversation_id: null,
  previous_conversations: [],
});
const group = (rootId, at, extra = {}) => ({
  root_id: rootId,
  title: null,
  ordinal_count: 1,
  in_progress_practice_id: null,
  favorite: false,
  hidden_at: null,
  last_practiced_at: at,
  practices: [round(`${rootId}-1`, at, { id: 'n', title: '말하기 직전의 멈춤', kind: 'action' })],
  ...extra,
});

test('코칭 입구: 연습이 없으면 「처음」 화면이다(SOMA-748)', () => {
  assert.deepEqual(coachingEntry([]), { kind: 'first' });
  // 숨긴 묶음만 있으면 처음과 같다.
  assert.deepEqual(coachingEntry([group('a', '2026-10-10T00:00:00Z', { hidden_at: '2026-10-11T00:00:00Z' })]), { kind: 'first' });
});

test('코칭 입구: 가장 최근 묶음의 마지막 노트 회차를 「지난번 다음에 해볼 것」으로 고른다', () => {
  const older = group('old', '2026-10-01T00:00:00Z');
  const newer = group('new', '2026-10-12T00:00:00Z', {
    practices: [
      round('new-1', '2026-10-11T00:00:00Z', { id: 'n1', title: '첫 노트', kind: 'action' }),
      round('new-2', '2026-10-12T00:00:00Z', null),
    ],
  });
  const entry = coachingEntry([older, newer]);
  assert.equal(entry.kind, 'next');
  assert.equal(entry.group.root_id, 'new');
  assert.equal(entry.notePracticeId, 'new-1');
  assert.equal(entry.noteTitle, '첫 노트');
});

test('코칭 입구: 노트가 하나도 없으면 노트 회차는 null 이다', () => {
  const g = group('x', '2026-10-12T00:00:00Z', { practices: [round('x-1', '2026-10-12T00:00:00Z', null)] });
  const entry = coachingEntry([g]);
  assert.equal(entry.kind, 'next');
  assert.equal(entry.notePracticeId, null);
  assert.equal(entry.noteTitle, null);
});

test('하단 탭은 홈·코칭·대본·챌린지·프로필이고 가운데 촬영 버튼은 없다(SOMA-748)', () => {
  const layout = src('app/(tabs)/_layout.tsx');
  const order = [...layout.matchAll(/<Tabs\.Screen\s+name="([a-z]+)"/g)].map((m) => m[1]);
  const visible = order.filter((name) => !new RegExp(`name="${name}"\\s+options=\\{\\{\\s*href: null`).test(layout));
  assert.deepEqual(visible, ['index', 'coaching', 'reading', 'challenges', 'profile']);
  assert.doesNotMatch(layout, /styles\.fab\b/);
});
