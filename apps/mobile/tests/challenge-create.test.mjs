import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attemptFor,
  buildCreateBody,
  createFailure,
  draftOverflow,
  emptyChallengeDraft,
  fingerprintOf,
  isDuration,
  stepComplete,
} from '../lib/challenge/create.ts';
import { CHALLENGE_DURATIONS, CHARACTER_MAX, LINE_MAX, SCENE_NOTE_MAX, WORK_MAX } from '../lib/challenge/types.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });
const draft = (over = {}) => ({ ...emptyChallengeDraft, line: '가지 마', work: '옥상, 밤', ...over });

test('challenge.create: 대사·작품·인물·기간 7일로 개설하면 본문이 그대로 실린다', () => {
  const body = buildCreateBody('req-1', draft({ character: '윤서', sceneNote: '  옥상에서 붙잡는 장면  ' }));

  assert.deepEqual(body, {
    request_id: 'req-1',
    line: '가지 마',
    work: '옥상, 밤',
    character: '윤서',
    scene_note: '옥상에서 붙잡는 장면',
    duration_days: 7,
  });
});

test('challenge.create: 기간은 7일·14일 선택지뿐이고 그 밖의 값은 보내지 않는다', () => {
  assert.deepEqual([...CHALLENGE_DURATIONS], [7, 14]);
  assert.equal(isDuration(7), true);
  assert.equal(isDuration(14), true);
  assert.equal(isDuration(10), false);
  assert.equal(buildCreateBody('req-2', draft({ durationDays: 14 })).duration_days, 14);
  // 선택지 밖 값이면 마지막 단계에서 넘어가지 못한다.
  assert.equal(stepComplete({ ...draft(), durationDays: 10 }, 2), false);
});

test('challenge.create: 인물·메모는 선택이라 비우면 싣지 않는다', () => {
  const body = buildCreateBody('req-3', draft({ character: '   ', sceneNote: '' }));

  assert.equal('character' in body, false);
  assert.equal('scene_note' in body, false);
});

test('challenge.create: 글자 수는 코드 포인트로 세고 넘치면 화면이 먼저 막는다', () => {
  assert.equal(draftOverflow(draft({ line: '가'.repeat(LINE_MAX) })), null);
  assert.equal(draftOverflow(draft({ line: '가'.repeat(LINE_MAX + 1) })), 'line');
  assert.equal(draftOverflow(draft({ work: '가'.repeat(WORK_MAX + 1) })), 'work');
  assert.equal(draftOverflow(draft({ character: '가'.repeat(CHARACTER_MAX + 1) })), 'character');
  assert.equal(draftOverflow(draft({ sceneNote: '가'.repeat(SCENE_NOTE_MAX + 1) })), 'sceneNote');
  // 이모지 하나는 한 글자다.
  assert.equal(draftOverflow(draft({ line: '🙂'.repeat(LINE_MAX) })), null);
});

test('challenge.create: 대사와 작품은 필수라 비우면 다음 단계로 못 간다', () => {
  assert.equal(stepComplete({ ...emptyChallengeDraft }, 0), false);
  assert.equal(stepComplete(draft({ line: '  ' }), 0), false);
  assert.equal(stepComplete(draft(), 0), true);
  assert.equal(stepComplete(draft({ work: '' }), 1), false);
  // 창작물이면 작품 자리에 "창작"을 적는다.
  assert.equal(stepComplete(draft({ work: '창작' }), 1), true);
});

test('challenge.create: 같은 본문을 다시 보내면 같은 요청 id 다 — 챌린지는 하나다', () => {
  let n = 0;
  const makeId = () => `req-${(n += 1)}`;
  const body = buildCreateBody('ignored', draft());

  const first = attemptFor(null, fingerprintOf(body), makeId);
  const again = attemptFor(first, fingerprintOf(body), makeId);
  assert.deepEqual(again, first);
  assert.equal(n, 1);

  const edited = buildCreateBody('ignored', draft({ line: '가지 마, 딱 한 번만' }));
  const third = attemptFor(again, fingerprintOf(edited), makeId);
  assert.notEqual(third.requestId, first.requestId);
});

test('challenge.create: 중복 대사·기간 오류·하루 한도·게스트를 갈라 본다', () => {
  assert.deepEqual(createFailure(apiError(422, 'duplicate_challenge')), { kind: 'duplicate' });
  assert.deepEqual(createFailure(apiError(422, 'invalid_duration')), { kind: 'invalid_duration' });
  assert.deepEqual(createFailure(apiError(429, 'daily_challenge_limit')), { kind: 'daily_limit' });
  assert.deepEqual(createFailure(apiError(422, 'request_fingerprint_mismatch')), { kind: 'fingerprint_mismatch' });
  assert.deepEqual(createFailure(apiError(403, 'member_only')), { kind: 'member_only' });
  assert.deepEqual(createFailure(Object.assign(new Error('x'), { name: 'NetworkError' })), { kind: 'offline' });
});
