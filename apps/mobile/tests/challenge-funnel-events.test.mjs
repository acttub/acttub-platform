import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CHALLENGE_FUNNEL_EVENTS,
  permissionResultParams,
  submitFailedParams,
  uploadFailedParams,
  uploadParams,
  videoSourceParams,
  visibilityParams,
} from '../lib/challenge/funnel.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

/**
 * SOMA-616 챌린지 참여 깔때기 — 참여하기(challenge_perform_tap)와 제출(challenge_entry_created)
 * 사이의 단계 이벤트가 GA4 규칙을 지키고, 화면에 실제로 걸려 있는지 잠근다.
 */

test('챌린지 깔때기 이벤트 이름은 GA4 규칙(snake_case, 40자 이내)을 지킨다', () => {
  for (const name of Object.values(CHALLENGE_FUNNEL_EVENTS)) {
    assert.match(name, /^challenge_[a-z_]+$/);
    assert.ok(name.length <= 40, name);
  }
});

test('파라미터는 단계 결과만 담고 id·캡션 같은 정보는 넣지 않는다', () => {
  assert.deepEqual(permissionResultParams({ granted: true }, { granted: false }, true), {
    camera: 'granted',
    microphone: 'denied',
    prompted: 'yes',
  });
  assert.deepEqual(permissionResultParams(null, undefined, false), { camera: 'denied', microphone: 'denied', prompted: 'no' });
  assert.deepEqual(videoSourceParams('gallery', 'cancelled'), { source: 'gallery', result: 'cancelled' });
  assert.deepEqual(uploadParams('library'), { origin: 'library' });
  assert.deepEqual(uploadFailedParams('video_too_long'), { reason: 'video_too_long' });
  assert.deepEqual(visibilityParams('private'), { visibility: 'private' });
  assert.deepEqual(submitFailedParams({ kind: 'daily_limit' }), { reason: 'daily_limit' });
});

test('촬영 화면: 챌린지 모드에서 권한 결과와 촬영·갤러리 선택 결과를 남긴다', () => {
  const record = read('app/record-video.tsx');

  assert.match(record, /CHALLENGE_FUNNEL_EVENTS\.permissionResult, permissionResultParams\(cam, mic, true\)/);
  assert.match(record, /CHALLENGE_FUNNEL_EVENTS\.permissionResult, permissionResultParams\(camPerm, micPerm, false\)/);
  assert.match(record, /videoSourceParams\('camera', result\?\.uri \? 'selected' : 'failed'\)/);
  assert.match(record, /videoSourceParams\('gallery', picked \? 'selected' : 'cancelled'\)/);
});

test('올리기 화면: 업로드 시작·성공·실패, 공개 범위 선택, 제출 실패 사유를 남긴다', () => {
  const upload = read('app/challenge-upload.tsx');

  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.uploadStarted, uploadParams\('new'\)/);
  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.uploadSucceeded, uploadParams\('new'\)/);
  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.uploadSucceeded, uploadParams\('library'\)/);
  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.uploadFailed, uploadFailedParams\(outcome\.code\)/);
  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.visibilitySelected, visibilityParams\(next\)/);
  assert.match(upload, /onPress=\{\(\) => chooseVisibility\('public'\)\}/);
  assert.match(upload, /onPress=\{\(\) => chooseVisibility\('private'\)\}/);
  assert.match(upload, /CHALLENGE_FUNNEL_EVENTS\.submitFailed, submitFailedParams\(failure\)/);
  // 제출 성공은 기존 이벤트를 그대로 쓴다.
  assert.match(upload, /logEvent\('challenge_entry_created', \{ visibility \}\)/);
});
