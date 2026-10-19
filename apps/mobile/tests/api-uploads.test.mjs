import assert from 'node:assert/strict';
import test from 'node:test';

import { api, id, sample } from './helpers/m4-N1-api.mjs';

const UPLOAD_FAIL = '영상 업로드에 실패했어요. 네트워크를 확인해주세요.';

/** expo-file-system 의 UploadTask 대역. uploadAsync 결과를 시험이 정한다. */
function fakeUploadTask() {
  const task = { created: [], cancelCount: 0 };
  let settle;
  task.outcome = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  task.resolve = value => settle.resolve(value);
  task.reject = error => settle.reject(error);
  globalThis.__m4n1CreateUploadTask = (...args) => {
    task.created.push(args);
    return {
      uploadAsync: () => task.outcome,
      cancelAsync: async () => {
        task.cancelCount += 1;
      },
    };
  };
  return task;
}

test('startUploadToUrl: 서명 주소에 파일을 PUT 으로 올리고 2xx 면 uploaded', async () => {
  const task = fakeUploadTask();
  const upload = api.startUploadToUrl('https://storage.test/put?sig=1', 'file:///clip.mp4', 'video/mp4');
  task.resolve({ status: 200 });
  assert.deepEqual(await upload.result, { kind: 'uploaded' });
  assert.deepEqual(task.created, [[
    'https://storage.test/put?sig=1',
    'file:///clip.mp4',
    { httpMethod: 'PUT', uploadType: 0, headers: { 'Content-Type': 'video/mp4' } },
  ]]);
});

for (const status of [403, 500]) {
  test(`startUploadToUrl: 저장소가 ${status} 로 답하면 업로드 실패 문구의 ApiError`, async () => {
    const task = fakeUploadTask();
    const upload = api.startUploadToUrl('https://storage.test/put', 'file:///clip.mp4', 'video/mp4');
    task.resolve({ status });
    await assert.rejects(upload.result, { name: 'ApiError', status, message: UPLOAD_FAIL });
  });
}

test('startUploadToUrl: 네이티브가 결과 없이 끝나면(취소) cancelled', async () => {
  const task = fakeUploadTask();
  const upload = api.startUploadToUrl('https://storage.test/put', 'file:///clip.mp4', 'video/mp4');
  task.resolve(null);
  assert.deepEqual(await upload.result, { kind: 'cancelled' });
});

test('startUploadToUrl: 취소한 뒤 끝난 업로드는 성공이어도 cancelled 이고 네이티브 취소를 부른다', async () => {
  const task = fakeUploadTask();
  const upload = api.startUploadToUrl('https://storage.test/put', 'file:///clip.mp4', 'video/mp4');
  await upload.cancel();
  task.resolve({ status: 200 });
  assert.deepEqual(await upload.result, { kind: 'cancelled' });
  assert.equal(task.cancelCount, 1);
});

test('startUploadToUrl: 취소 때문에 네이티브가 던진 오류는 cancelled 로 삼킨다', async () => {
  const task = fakeUploadTask();
  const upload = api.startUploadToUrl('https://storage.test/put', 'file:///clip.mp4', 'video/mp4');
  await upload.cancel();
  task.reject(new Error('task cancelled'));
  assert.deepEqual(await upload.result, { kind: 'cancelled' });
});

test('startUploadToUrl: 취소하지 않았는데 네이티브가 던지면 그 오류를 그대로 올린다', async () => {
  const task = fakeUploadTask();
  const upload = api.startUploadToUrl('https://storage.test/put', 'file:///clip.mp4', 'video/mp4');
  const failure = new Error('disk full');
  task.reject(failure);
  await assert.rejects(upload.result, failure);
});

function captureMultipart(t, responseBody) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, headers: new Headers(init.headers), form: init.body });
    return Response.json(responseBody, { status: 201 });
  });
  return calls;
}

const recordingInput = {
  request_id: id(40),
  line_id: id(41),
  attempt_no: 2,
  duration_ms: 3_500,
  transcript_source: 'stt',
  audio: { uri: 'file:///line.m4a', name: 'line.m4a', type: 'audio/mp4' },
};

test('uploadReadingRecording: 녹음 한 줄을 multipart 로 보내고 요청 id 를 헤더에도 싣는다', async t => {
  const recording = sample('ReadingSessionRecording');
  const calls = captureMultipart(t, recording);
  const result = await api.uploadReadingRecording(id(3), { ...recordingInput, transcript: '나는 갈매기' });

  assert.deepEqual(result, recording);
  const [sent] = calls;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.url.pathname, `/v2/reading/sessions/${id(3)}/recordings`);
  assert.equal(sent.headers.get('X-Request-Id'), id(40));
  assert.equal(sent.headers.get('Content-Type'), null, 'multipart 경계는 fetch 가 붙인다');
  assert.deepEqual(
    ['request_id', 'line_id', 'attempt_no', 'duration_ms', 'transcript_source', 'transcript'].map(key => sent.form.get(key)),
    [id(40), id(41), '2', '3500', 'stt', '나는 갈매기'],
  );
  assert.equal(sent.form.has('audio'), true);
});

test('uploadReadingRecording: 받아쓰기가 없으면 transcript 칸을 보내지 않는다', async t => {
  const calls = captureMultipart(t, sample('ReadingSessionRecording'));
  await api.uploadReadingRecording(id(3), { ...recordingInput, transcript: null, transcript_source: 'none' });
  assert.equal(calls[0].form.has('transcript'), false);
  assert.equal(calls[0].form.get('transcript_source'), 'none');
});
