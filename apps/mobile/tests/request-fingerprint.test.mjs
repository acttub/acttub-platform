import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintOf as challengeFingerprint } from '../lib/challenge/create.ts';
import { entryFingerprint } from '../lib/challenge/entry.ts';
import { fingerprintOf as practiceFingerprint } from '../lib/practice/start.ts';

// 기기가 "같은 요청"을 알아보는 지문을 글자 그대로 고정한다. 이 글자가 바뀌면 앱을 올린 직후의 재전송이
// 새 요청 id 로 나가 회차·챌린지·참여작이 둘이 될 수 있다 — 요청 id 재사용 규칙을 한곳으로 모아도 지문은 그대로다.
test('연습 시작 지문', () => {
  const scene = { situation: '이별 직후', character: '친구', goal: '붙잡기' };
  const blockage = { category: '그 외', detail: '그 외', note: null };
  assert.equal(
    practiceFingerprint({ request_id: 'r', video_id: 'v1', scene, blockage }),
    '["v1","이별 직후","친구","붙잡기","그 외","그 외",null]',
  );
  assert.equal(practiceFingerprint({ request_id: 'r', scene, blockage }), '[null,"이별 직후","친구","붙잡기","그 외","그 외",null]');
});

test('챌린지 개설 지문', () => {
  assert.equal(
    challengeFingerprint({ request_id: 'r', line: '가지 마.', work: '창작', character: null, scene_note: null, duration_days: 7 }),
    '["가지 마.","창작","","",7]',
  );
});

test('참여작 지문', () => {
  assert.equal(entryFingerprint({ request_id: 'r', video_id: 'v1', visibility: 'public' }), '["v1","","public"]');
  assert.equal(entryFingerprint({ request_id: 'r', video_id: 'v1', caption: '한 줄', visibility: 'private' }), '["v1","한 줄","private"]');
});
