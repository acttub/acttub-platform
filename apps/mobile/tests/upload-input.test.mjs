import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VIDEO_DURATION_MS,
  missingUploadFieldsHint,
  sceneValueForDisplay,
  sceneValueForSubmit,
  normalizeVideoDurationMs,
  objectParticle,
} from '../lib/upload-input.ts';

test('영상 길이를 길이 검사와 요청에 쓸 동일한 정수 millisecond로 정규화한다', () => {
  assert.equal(normalizeVideoDurationMs(12345.678), 12346);
  assert.equal(normalizeVideoDurationMs(12345.0), 12345);
  assert.equal(normalizeVideoDurationMs(null), null);
  assert.equal(normalizeVideoDurationMs(Number.NaN), null);
  assert.equal(normalizeVideoDurationMs(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeVideoDurationMs(0), null);
  assert.equal(MAX_VIDEO_DURATION_MS, 300_000);
});

test('F10: 질문 받기가 막혀 있으면 빠진 항목을 알려준다 — 장면 칸은 선택이라 세지 않는다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '',
      character: '',
      goal: '',
      hasVideo: false,
      agreedRights: false,
    }),
    '영상을 채워주세요',
  );
});

test('F10: 입력이 다 찼고 체크만 남았으면 체크를 안내한다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '카페',
      character: '20대 여성',
      goal: '무너지는 순간',
      hasVideo: true,
      agreedRights: false,
    }),
    '권리 확인에 체크해주세요',
  );
});

test('F10: 장면을 전부 비워도 영상·권리만 채우면 안내 문구가 없다 (SOMA-432)', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '',
      character: '',
      goal: '',
      hasVideo: true,
      agreedRights: true,
    }),
    null,
  );
});

test('F10: 전부 채우면 안내 문구가 없다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '카페',
      character: '20대 여성',
      goal: '무너지는 순간',
      hasVideo: true,
      agreedRights: true,
    }),
    null,
  );
});

test('F10: 받침 유무로 을/를을 고른다', () => {
  assert.equal(objectParticle('의도'), '를');
  assert.equal(objectParticle('상황'), '을');
  assert.equal(objectParticle('영상'), '을');
  assert.equal(objectParticle('인물'), '을');
  assert.equal(objectParticle('video'), '을');
});

test('빈 장면 칸과 공백만 있는 칸은 자리표시자 없이 빈 문자열로 제출한다 (ADR-021)', () => {
  assert.equal(sceneValueForSubmit(''), '');
  assert.equal(sceneValueForSubmit('   '), '');
  assert.equal(sceneValueForSubmit('  카페에서  '), '카페에서');
});

test('예전 빌드가 저장한 자리표시자는 표시에서 빈 값으로 되돌리고, 한 글자 장면은 남긴다', () => {
  assert.equal(sceneValueForDisplay('.'), '');
  assert.equal(sceneValueForDisplay(' . '), '');
  assert.equal(sceneValueForDisplay('밤'), '밤');
  assert.equal(sceneValueForDisplay('카페.'), '카페.');
  assert.equal(sceneValueForDisplay('카페에서'), '카페에서');
});
