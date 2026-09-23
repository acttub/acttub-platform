import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKAGE_NOTE_MAX,
  SCENE_MAX,
  blockageNoteOverflow,
  buildContinueBody,
  buildStartBody,
  emptyBlockageDraft,
  emptySceneDraft,
  inProgressPracticeId,
  attemptFor,
  fingerprintOf,
  sceneOverflow,
  startFailure,
} from '../lib/practice/start.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });
const networkError = () => Object.assign(new Error('offline'), { name: 'NetworkError' });

test('practice.start: 영상만 고르고 시작하면 장면은 빈 문자열, 막힘은 그 외/그 외다', () => {
  const body = buildStartBody({
    requestId: 'req-1',
    videoId: 'video-1',
    scene: emptySceneDraft,
    blockage: emptyBlockageDraft,
  });

  assert.deepEqual(body, {
    request_id: 'req-1',
    video_id: 'video-1',
    scene: { situation: '', character: '', goal: '' },
    blockage: { category: '그 외', detail: '그 외', note: null },
  });
});

test('practice.start: 상황과 막힘(표현 › 감정)을 적으면 저장값이 그대로다', () => {
  const body = buildStartBody({
    requestId: 'req-2',
    videoId: 'video-2',
    scene: { situation: ' 이별 직후 카페 ', character: '참는 사람', goal: '' },
    blockage: { category: '표현', detail: '감정', note: '  마지막 대사가 붕 떠요  ' },
  });

  assert.equal(body.scene.situation, '이별 직후 카페');
  assert.equal(body.scene.goal, '');
  assert.deepEqual(body.blockage, { category: '표현', detail: '감정', note: '마지막 대사가 붕 떠요' });
});

test('practice.start: 상황 300자는 보내고 301자는 화면이 먼저 막는다', () => {
  const ok = { ...emptySceneDraft, situation: '가'.repeat(SCENE_MAX) };
  const over = { ...emptySceneDraft, situation: '가'.repeat(SCENE_MAX + 1) };

  assert.equal(sceneOverflow(ok), null);
  assert.equal(sceneOverflow(over), 'situation');
  assert.equal(sceneOverflow({ ...emptySceneDraft, goal: '나'.repeat(SCENE_MAX + 1) }), 'goal');
});

test('practice.start: 막힘 서술 500자는 보내고 501자는 화면이 먼저 막는다', () => {
  assert.equal(blockageNoteOverflow({ ...emptyBlockageDraft, note: '가'.repeat(BLOCKAGE_NOTE_MAX) }), false);
  assert.equal(blockageNoteOverflow({ ...emptyBlockageDraft, note: '가'.repeat(BLOCKAGE_NOTE_MAX + 1) }), true);
});

test('practice.start: 같은 시도를 두 번 보내면 요청 id와 본문이 같다 — 회차는 하나다', () => {
  const input = {
    requestId: 'req-3',
    videoId: 'video-3',
    scene: { situation: '옥상', character: '', goal: '' },
    blockage: emptyBlockageDraft,
  };

  assert.deepEqual(buildStartBody(input), buildStartBody(input));
});

test('practice.start: 이중 탭은 같은 요청 id 로 가고 본문을 고치면 새 id 로 간다', () => {
  let n = 0;
  const makeId = () => `req-${(n += 1)}`;
  const body = buildStartBody({
    requestId: 'ignored',
    videoId: 'video-1',
    scene: emptySceneDraft,
    blockage: emptyBlockageDraft,
  });

  const first = attemptFor(null, fingerprintOf(body), makeId);
  const again = attemptFor(first, fingerprintOf(body), makeId);
  assert.deepEqual(again, first);
  assert.equal(n, 1);

  const edited = buildStartBody({
    requestId: 'ignored',
    videoId: 'video-1',
    scene: { ...emptySceneDraft, situation: '옥상' },
    blockage: emptyBlockageDraft,
  });
  const third = attemptFor(again, fingerprintOf(edited), makeId);
  assert.notEqual(third.requestId, first.requestId);
});

test('practice.start: 확정 안 된 영상·게스트 한도·지문 불일치·연결 끊김을 갈라 본다', () => {
  assert.deepEqual(startFailure(apiError(422, 'video_not_ready')), { kind: 'video_not_ready' });
  assert.deepEqual(startFailure(apiError(429, 'guest_daily_analysis_limit')), { kind: 'daily_limit' });
  assert.deepEqual(startFailure(apiError(422, 'request_fingerprint_mismatch')), { kind: 'fingerprint_mismatch' });
  assert.deepEqual(startFailure(networkError()), { kind: 'offline' });
  assert.deepEqual(startFailure(apiError(503, 'upstream')), { kind: 'offline' });
  assert.deepEqual(startFailure(apiError(404, 'not_found')), { kind: 'other', status: 404, code: 'not_found' });
});

test('practice.resume: 진행 중 회차가 있으면 409이고 회차 id는 묶음 조회에서 얻는다', () => {
  assert.deepEqual(startFailure(apiError(409, 'practice_in_progress')), { kind: 'in_progress' });

  const groups = [
    { root_id: 'root-1', title: null, ordinal_count: 2, in_progress_practice_id: null, favorite: false, hidden_at: null },
    { root_id: 'root-2', title: null, ordinal_count: 1, in_progress_practice_id: 'practice-9', favorite: false, hidden_at: null },
  ];

  assert.equal(inProgressPracticeId(groups), 'practice-9');
  assert.equal(inProgressPracticeId(groups, 'root-2'), 'practice-9');
  assert.equal(inProgressPracticeId(groups, 'root-1'), null);
});

test('practice.resume: 같은 영상이면 video_id를 싣지 않고 새 영상이면 싣는다', () => {
  const base = { requestId: 'req-4', scene: emptySceneDraft, blockage: emptyBlockageDraft };

  const same = buildContinueBody({ ...base, videoId: null });
  assert.equal('video_id' in same, false);

  const fresh = buildContinueBody({ ...base, videoId: 'video-new' });
  assert.equal(fresh.video_id, 'video-new');
  assert.equal(fresh.request_id, 'req-4');
});
