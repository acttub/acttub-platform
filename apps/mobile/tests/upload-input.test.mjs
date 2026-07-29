import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VIDEO_DURATION_MS,
  missingUploadFieldsHint,
  normalizeVideoDurationMs,
  prepareUploadIntentBody,
  sendUploadIntent,
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

test('fetch 직전 upload intent body에는 정규화된 정수 duration_ms가 들어간다', async () => {
  const calls = [];
  const mockFetch = async (body) => {
    calls.push(body);
    return { intent_id: 'intent-1' };
  };

  const result = await sendUploadIntent(
    {
      mime_type: 'video/mp4',
      size_bytes: 2048,
      duration_ms: normalizeVideoDurationMs(12345.678),
    },
    mockFetch,
  );

  assert.deepEqual(result, { intent_id: 'intent-1' });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]), {
    mime_type: 'video/mp4',
    size_bytes: 2048,
    duration_ms: 12346,
  });
});

for (const [name, input] of [
  ['비유한 size_bytes', {
    mime_type: 'video/mp4',
    size_bytes: Number.POSITIVE_INFINITY,
    duration_ms: null,
  }],
  ['0 duration_ms', { mime_type: 'video/mp4', size_bytes: 2048, duration_ms: 0 }],
  ['비유한 duration_ms', {
    mime_type: 'video/mp4',
    size_bytes: 2048,
    duration_ms: Number.POSITIVE_INFINITY,
  }],
  ['소수 size_bytes', { mime_type: 'video/mp4', size_bytes: 20.5, duration_ms: null }],
  ['0 size_bytes', { mime_type: 'video/mp4', size_bytes: 0, duration_ms: null }],
]) {
  test(`${name}는 fetch 전에 거부한다`, async () => {
    let fetchCalls = 0;
    await assert.rejects(
      sendUploadIntent(input, async () => {
        fetchCalls += 1;
        return {};
      }),
      /양의 정수/,
    );
    assert.equal(fetchCalls, 0);
  });
}

test('F10: 분석 시작이 막혀 있으면 빠진 항목을 한 줄로 알려준다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '',
      character: '',
      subtext: '',
      hasVideo: false,
      agreedRights: false,
    }),
    '영상 · 상황 · 인물 · 의도을(를) 채워주세요',
  );
});

test('F10: 입력이 다 찼고 체크만 남았으면 체크를 안내한다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '카페',
      character: '20대 여성',
      subtext: '무너지는 순간',
      hasVideo: true,
      agreedRights: false,
    }),
    '권리 확인에 체크해주세요',
  );
});

test('F10: 공백만 입력한 칸은 채운 것으로 보지 않는다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '   ',
      character: '20대 여성',
      subtext: '무너지는 순간',
      hasVideo: true,
      agreedRights: true,
    }),
    '상황을(를) 채워주세요',
  );
});

test('F10: 전부 채우면 안내 문구가 없다', () => {
  assert.equal(
    missingUploadFieldsHint({
      situation: '카페',
      character: '20대 여성',
      subtext: '무너지는 순간',
      hasVideo: true,
      agreedRights: true,
    }),
    null,
  );
});
