import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PRACTICE_GOAL,
  formatVideoDuration,
  groupTagLabels,
  groupVideoDuration,
  practiceProgress,
} from '../lib/practice/coaching-progress.ts';
import { practiceGroupFromResponse } from '../lib/practice/groups.ts';

test('진행: 값이 없거나(스위치 꺼짐) null(옛 자료)이면 숨김(null)', () => {
  assert.equal(practiceProgress({}), null);
  assert.equal(practiceProgress({ practice_count: null, practice_goal: 3 }), null);
  assert.equal(practiceProgress({ practice_count: -1 }), null);
  assert.equal(practiceProgress({ practice_count: Number.NaN }), null);
});

test('진행: 목표 안이면 「n/3번 해 봤어요」, 채운 점 n개', () => {
  assert.deepEqual(practiceProgress({ practice_count: 2, practice_goal: 3 }), { count: 2, goal: 3, filled: 2, label: '2/3번 해 봤어요' });
  assert.deepEqual(practiceProgress({ practice_count: 0, practice_goal: 3 }), { count: 0, goal: 3, filled: 0, label: '0/3번 해 봤어요' });
  assert.equal(practiceProgress({ practice_count: 3, practice_goal: 3 }).label, '3/3번 해 봤어요');
});

test('진행: 목표를 넘으면 점은 다 채우고 「n번 해 봤어요」', () => {
  assert.deepEqual(practiceProgress({ practice_count: 5, practice_goal: 3 }), { count: 5, goal: 3, filled: 3, label: '5번 해 봤어요' });
});

test('진행: 목표가 없거나 0 이하면 기본 3', () => {
  assert.equal(DEFAULT_PRACTICE_GOAL, 3);
  assert.equal(practiceProgress({ practice_count: 1 }).goal, 3);
  assert.equal(practiceProgress({ practice_count: 1, practice_goal: 0 }).label, '1/3번 해 봤어요');
});

test('영상 길이: m:ss, 값이 없거나 0 이하면 null', () => {
  assert.equal(formatVideoDuration(72_000), '1:12');
  assert.equal(formatVideoDuration(5_400), '0:05');
  assert.equal(formatVideoDuration(400), '0:01');
  assert.equal(formatVideoDuration(59_600), '1:00');
  assert.equal(formatVideoDuration(605_000), '10:05');
  assert.equal(formatVideoDuration(null), null);
  assert.equal(formatVideoDuration(undefined), null);
  assert.equal(formatVideoDuration(0), null);
  assert.equal(formatVideoDuration(Number.POSITIVE_INFINITY), null);
});

test('영상 길이: 묶음의 마지막 회차 값을 쓴다', () => {
  const practices = [
    { ordinal: 2, video_duration_ms: 30_000 },
    { ordinal: 1, video_duration_ms: 90_000 },
  ];
  assert.equal(groupVideoDuration({ practices }), '0:30');
  assert.equal(groupVideoDuration({ practices: [{ ordinal: 1 }] }), null);
  assert.equal(groupVideoDuration({ practices: [] }), null);
});

test('태그: 아는 값만 사람이 읽는 말로, 중복·모르는 값·빈 값은 뺀다', () => {
  assert.deepEqual(groupTagLabels({ tags: ['emotion_memory', 'resolved', 'emotion_memory', 'unknown'] }), ['감정 기억', '해결']);
  assert.deepEqual(groupTagLabels({ tags: [] }), []);
  assert.deepEqual(groupTagLabels({}), []);
});

test('묶음 응답 변환: 진행 값과 회차 영상 길이를 옮기고, 없는 키는 만들지 않는다', () => {
  const practice = (extra) => ({
    id: 'p1', ordinal: 1, created_at: '2026-10-01T00:00:00Z', stage: 'done', conversation_count: 2,
    note_id: null, note_kind: null, note_title: null, conversation_id: null, previous_conversations: [],
    video_id: 'v1', situation: '카페', poster_url: null, ...extra,
  });
  const base = { root_id: 'r', title: null, ordinal_count: 1, last_conversation_at: null, tags: [], favorite: false, hidden_at: null, in_progress_practice_id: null };
  const on = practiceGroupFromResponse({ ...base, practice_count: 2, practice_goal: 3, practices: [practice({ video_duration_ms: 72_000 })] });
  assert.equal(on.practice_count, 2);
  assert.equal(on.practice_goal, 3);
  assert.equal(on.practices[0].video_duration_ms, 72_000);
  const off = practiceGroupFromResponse({ ...base, practices: [practice({})] });
  assert.equal('practice_count' in off, false);
  assert.equal('video_duration_ms' in off.practices[0], false);
  const nul = practiceGroupFromResponse({ ...base, practice_count: null, practices: [practice({ video_duration_ms: null })] });
  assert.equal(nul.practices[0].video_duration_ms, null);
  assert.equal(practiceProgress(nul), null);
});
