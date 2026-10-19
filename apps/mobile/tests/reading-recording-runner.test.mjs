import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

import { ApiError } from '../lib/api-request.ts';

// 녹음 올리기 배선은 그대로 돌리고 기기 저장소·파일·리딩 API·파일 삭제만 기억 속 가짜로 바꾼다.
globalThis.__runnerTest = {};
const s = globalThis.__runnerTest;
const fakes = {
  '@react-native-async-storage/async-storage': `const s = globalThis.__runnerTest;
    export default {
      getItem: async (k) => s.storage.get(k) ?? null,
      setItem: async (k, v) => { s.storage.set(k, v); },
      removeItem: async (k) => { s.storage.delete(k); },
    };`,
  'expo-file-system': `const s = globalThis.__runnerTest;
    export class File {
      constructor(uri) { if (s.badUris.has(uri)) throw new Error('bad uri'); this.uri = uri; }
      get exists() { return s.files.has(this.uri); }
      get size() { return s.files.get(this.uri)?.length; }
      async bytes() { if (s.unreadable) throw new Error('io'); return s.files.get(this.uri); }
      write(bytes) { s.files.set(this.uri, bytes); s.rewritten.push([this.uri, bytes]); }
    }`,
  '@/lib/account-files': `const s = globalThis.__runnerTest;
    export async function deleteDeviceFile(uri) { s.deleted.push(uri); s.files.delete(uri); }`,
  '@/lib/api': `const s = globalThis.__runnerTest;
    export const api = {
      async uploadReadingRecording(sessionId, body) {
        s.uploads.push([sessionId, body]);
        if (s.uploadError) throw s.uploadError;
        return { id: 'rec1', line_id: body.line_id, attempt_no: body.attempt_no };
      },
    };`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/reading/recording-runner.ts')) {
      if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
      if (specifier.startsWith('@/')) return next(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const runner = await import('../lib/reading/recording-runner.ts');

const QUEUE_KEY = 'acttub.reading.recordingQueue';

/** 소리가 작은 16비트 모노 WAV. */
function quietWav(samples = 6000, amplitude = 300) {
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at, text) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 ? amplitude : -amplitude, true);
  return bytes;
}
const peakOf = (wav) => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let peak = 0;
  for (let at = 44; at < wav.length; at += 2) peak = Math.max(peak, Math.abs(view.getInt16(at, true)));
  return peak;
};

function input(over = {}) {
  return {
    requestId: 'q1',
    sessionId: 'r1',
    lineId: 'l2',
    attemptNo: 1,
    uri: 'file:///rec/l2.m4a',
    contentType: 'audio/mp4',
    durationMs: 1500,
    transcript: '오늘 왔구나',
    transcriptSource: 'stt',
    ...over,
  };
}

let heard = [];
const stopHearing = runner.onRecordingQueueChange((n) => heard.push(n));

beforeEach(() => {
  Object.assign(s, {
    storage: new Map(),
    files: new Map(),
    badUris: new Set(),
    unreadable: false,
    rewritten: [],
    deleted: [],
    uploads: [],
    uploadError: null,
  });
  heard = [];
});

test('내 차례 녹음을 큐에 넣고 바로 올린 뒤 기기 파일을 지운다', async () => {
  s.files.set('file:///rec/l2.m4a', new Uint8Array(5000));

  assert.deepEqual(await runner.enqueueLineRecording(input()), { kind: 'queued' });
  await runner.flushRecordingUploads();

  assert.deepEqual(s.uploads, [['r1', {
    request_id: 'q1',
    line_id: 'l2',
    attempt_no: 1,
    duration_ms: 1500,
    transcript: '오늘 왔구나',
    transcript_source: 'stt',
    audio: { uri: 'file:///rec/l2.m4a', name: 'line.m4a', type: 'audio/mp4' },
  }]]);
  assert.deepEqual(s.deleted, ['file:///rec/l2.m4a']);
  assert.equal(await runner.pendingRecordingUploads(), 0);
  assert.equal(s.storage.has(QUEUE_KEY), false);
  assert.deepEqual([heard[0], heard.at(-1)], [1, 0]);
});

test('인식기가 남긴 작은 WAV 는 세기를 키워 다시 쓴 뒤 올린다', async () => {
  const wav = quietWav();
  s.files.set('file:///rec/l2.wav', wav);

  await runner.enqueueLineRecording(input({ uri: 'file:///rec/l2.wav', contentType: 'audio/wav' }));
  await runner.flushRecordingUploads();

  assert.deepEqual(s.rewritten.map(([uri]) => uri), ['file:///rec/l2.wav']);
  assert.equal(peakOf(wav), 300);
  assert.ok(peakOf(s.rewritten[0][1]) > 300);
  assert.deepEqual(s.uploads[0][1].audio, { uri: 'file:///rec/l2.wav', name: 'line.wav', type: 'audio/wav' });
});

test('WAV 를 읽지 못하면 세기를 맞추지 않고 그대로 올린다', async () => {
  s.files.set('file:///rec/l2.wav', quietWav());
  s.unreadable = true;

  assert.deepEqual(await runner.enqueueLineRecording(input({ uri: 'file:///rec/l2.wav', contentType: 'audio/wav' })), { kind: 'queued' });
  await runner.flushRecordingUploads();
  assert.deepEqual(s.rewritten, []);
  assert.equal(s.uploads.length, 1);
});

test('파일이 없거나 열 수 없으면 보내지 않고 지운다', async () => {
  assert.deepEqual(await runner.enqueueLineRecording(input()), { kind: 'rejected', reason: 'missing' });
  s.badUris.add('weird://x');
  assert.deepEqual(await runner.enqueueLineRecording(input({ uri: 'weird://x' })), { kind: 'rejected', reason: 'missing' });

  assert.deepEqual(s.deleted, ['file:///rec/l2.m4a', 'weird://x']);
  assert.deepEqual(s.uploads, []);
});

test('너무 크거나 길거나 소리가 없는 녹음은 이유와 함께 버린다', async () => {
  s.files.set('file:///big.m4a', new Uint8Array(10_000_001));
  s.files.set('file:///long.m4a', new Uint8Array(5000));
  s.files.set('file:///tiny.m4a', new Uint8Array(258));

  assert.deepEqual(await runner.enqueueLineRecording(input({ uri: 'file:///big.m4a' })), { kind: 'rejected', reason: 'too_large' });
  assert.deepEqual(await runner.enqueueLineRecording(input({ uri: 'file:///long.m4a', durationMs: 180_001 })), { kind: 'rejected', reason: 'too_long' });
  assert.deepEqual(await runner.enqueueLineRecording(input({ uri: 'file:///tiny.m4a' })), { kind: 'rejected', reason: 'empty' });
  assert.deepEqual(s.deleted, ['file:///big.m4a', 'file:///long.m4a', 'file:///tiny.m4a']);
});

test('끊겨서 못 올린 녹음은 큐에 남았다가 다음 올리기에서 보낸다', async () => {
  s.files.set('file:///rec/l2.m4a', new Uint8Array(5000));
  s.uploadError = new Error('offline');

  await runner.enqueueLineRecording(input());
  await runner.flushRecordingUploads();
  assert.equal(await runner.pendingRecordingUploads(), 1);
  assert.deepEqual(s.deleted, []);

  s.uploadError = null;
  await runner.flushRecordingUploads();
  assert.equal(await runner.pendingRecordingUploads(), 0);
  assert.equal(s.uploads.length, 2);
  assert.deepEqual(s.uploads.map(([, body]) => body.request_id), ['q1', 'q1']);
});

test('회차가 지워져 다시 보내도 같은 녹음은 버리고 바뀐 수를 알린다', async () => {
  s.files.set('file:///rec/l2.m4a', new Uint8Array(5000));
  s.uploadError = new ApiError(404, 'gone', 'session_not_found');

  await runner.enqueueLineRecording(input());
  await runner.flushRecordingUploads();
  assert.equal(await runner.pendingRecordingUploads(), 0);
  assert.deepEqual(s.deleted, ['file:///rec/l2.m4a']);
  assert.equal(heard.at(-1), 0);
});

test('구독을 끊으면 더는 알리지 않는다', async () => {
  stopHearing();
  s.files.set('file:///rec/l2.m4a', new Uint8Array(5000));

  await runner.enqueueLineRecording(input());
  await runner.flushRecordingUploads();
  assert.deepEqual(heard, []);
});
