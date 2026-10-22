import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CHALLENGE_FUNNEL_EVENTS, uploadExitParams as challengeExitParams, uploadExitStage } from '../lib/challenge/funnel.ts';
import {
  PRACTICE_UPLOAD_EVENTS,
  lengthBucket,
  rightsToggleParams,
  startBlockReason,
  startBlockedParams,
  uploadExitParams,
  videoPickedParams,
  videoReadyParams,
} from '../lib/practice/upload-events.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * SOMA-698 — 영상을 올리고 질문 받기·챌린지 제출을 안 누르는 지점을 센다.
 * 이름이 GA4 규칙을 지키고, 막힌 이유를 화면 안내와 같은 순서로 판정하며, 화면에 실제로 걸려 있는지 잠근다.
 */

test('이벤트 이름은 GA4 규칙(snake_case, 40자 이내)을 지킨다', () => {
  for (const name of [...Object.values(PRACTICE_UPLOAD_EVENTS), CHALLENGE_FUNNEL_EVENTS.uploadExit]) {
    assert.match(name, /^[a-z][a-z_]+$/);
    assert.ok(name.length <= 40, name);
  }
});

test('질문 받기가 막힌 이유는 영상 없음 → 올리는 중 → 권리 확인 순서다', () => {
  assert.equal(startBlockReason({ hasVideo: false, uploading: false, rights: false }), 'no_video');
  // 올리는 중인 영상은 "고른 영상"이다 — 영상 없음으로 세지 않는다.
  assert.equal(startBlockReason({ hasVideo: true, uploading: true, rights: false }), 'uploading');
  assert.equal(startBlockReason({ hasVideo: true, uploading: false, rights: false }), 'rights');
  assert.equal(startBlockReason({ hasVideo: true, uploading: false, rights: true }), null);
  assert.deepEqual(startBlockedParams('rights'), { reason: 'rights' });
});

test('영상 길이는 구간으로만 보낸다', () => {
  assert.equal(lengthBucket(null), 'unknown');
  assert.equal(lengthBucket(0), 'unknown');
  assert.equal(lengthBucket(865), 'lt3s');
  assert.equal(lengthBucket(3_000), '3_10s');
  assert.equal(lengthBucket(24_610), '10_30s');
  assert.equal(lengthBucket(59_999), '30_60s');
  assert.equal(lengthBucket(129_100), '1_3m');
  assert.equal(lengthBucket(286_000), 'gt3m');
});

test('파라미터에는 단계와 구간만 담고 id·경로·글은 넣지 않는다', () => {
  assert.deepEqual(videoPickedParams('gallery', true, 12_000), { source: 'gallery', needs_upload: 'yes', length: '10_30s' });
  assert.deepEqual(videoPickedParams('library', false, null), { source: 'library', needs_upload: 'no', length: 'unknown' });
  assert.deepEqual(videoReadyParams('record', 4_400), { source: 'record', wait_s: 4 });
  assert.deepEqual(rightsToggleParams(true), { checked: 'on' });
  assert.deepEqual(
    uploadExitParams({ hasVideo: true, uploading: false, rights: false, source: 'record', blockedTaps: 2, openedAt: 1_000, now: 61_400 }),
    { stage: 'rights', source: 'record', rights: 'off', blocked_taps: 2, stay_s: 60 },
  );
  // 모두 갖췄는데 누르지 않고 나간 경우
  assert.equal(
    uploadExitParams({ hasVideo: true, uploading: false, rights: true, source: 'gallery', blockedTaps: 0, openedAt: 0, now: 0 }).stage,
    'ready',
  );
  assert.equal(
    uploadExitParams({ hasVideo: false, uploading: false, rights: false, source: null, blockedTaps: 0, openedAt: 0, now: 0 }).source,
    'none',
  );
});

test('챌린지 올리기를 제출 없이 떠난 단계를 가른다', () => {
  assert.equal(uploadExitStage({ hasVideo: false, uploading: false, visibility: null }), 'no_video');
  assert.equal(uploadExitStage({ hasVideo: true, uploading: true, visibility: 'private' }), 'uploading');
  assert.equal(uploadExitStage({ hasVideo: true, uploading: false, visibility: null }), 'no_visibility');
  // 2026-10-12 녹화: "저장만 하기 · 비공개"를 고르고 저장 버튼을 누르지 않고 나감
  assert.deepEqual(
    challengeExitParams({ hasVideo: true, uploading: false, visibility: 'private', openedAt: 0, now: 10_200 }),
    { stage: 'ready', visibility: 'private', stay_s: '10' },
  );
});

test('업로드 화면과 챌린지 올리기 화면에 이벤트가 걸려 있다', () => {
  const upload = read('app/upload.tsx');
  for (const key of ['videoPicked', 'videoReady', 'rightsToggle', 'startBlocked', 'screenExit']) {
    assert.ok(upload.includes(`PRACTICE_UPLOAD_EVENTS.${key}`), key);
  }
  // 회색 버튼도 눌림을 받아야 막힌 이유를 셀 수 있다 — disabled 는 시작 중일 때만 건다.
  assert.match(upload, /disabled=\{starting\}/);
  assert.match(upload, /accessibilityState=\{\{ disabled: !canSubmit \|\| starting \}\}/);
  assert.ok(read('app/challenge-upload.tsx').includes('CHALLENGE_FUNNEL_EVENTS.uploadExit'));
  assert.ok(read('app/record-video.tsx').includes("source: 'record'"));
});
