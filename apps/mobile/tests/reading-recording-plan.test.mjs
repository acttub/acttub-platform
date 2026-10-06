import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MS,
  checkRecordingFile,
  contentTypeFor,
  fileNameFor,
  latestRecordings,
  nextAttemptNo,
  transcriptFields,
} from '../lib/reading/recording-plan.ts';

test('reading.recording: 앱은 형식을 실제대로 보낸다 — 녹음기 m4a는 audio/mp4, 인식기 파일 wav는 audio/wav', () => {
  assert.equal(contentTypeFor('file:///cache/Audio/rec.m4a', 'recorder'), 'audio/mp4');
  assert.equal(contentTypeFor('file:///cache/recording_1.wav', 'stt_persist'), 'audio/wav');
  assert.equal(contentTypeFor('file:///cache/audio_x.caf', 'stt_persist'), 'audio/x-caf');
  assert.equal(contentTypeFor('file:///cache/unknown', 'recorder'), 'audio/mp4', '확장자를 모르면 녹음기는 m4a');
  assert.equal(contentTypeFor('file:///cache/unknown', 'stt_persist'), 'audio/wav', '확장자를 모르면 인식기는 wav');
  assert.equal(fileNameFor('audio/mp4'), 'line.m4a');
  assert.equal(fileNameFor('audio/wav'), 'line.wav');
});

test('reading.recording: 파일이 10,000,000바이트를 넘으면 기기가 보내지 않고, 180초를 넘는 길이도 보내지 않는다', () => {
  assert.equal(RECORDING_MAX_BYTES, 10_000_000);
  assert.equal(RECORDING_MAX_MS, 180_000);
  assert.deepEqual(checkRecordingFile({ byteSize: 10_000_001, durationMs: 1_000 }), { ok: false, reason: 'too_large' });
  assert.deepEqual(checkRecordingFile({ byteSize: 10_000_000, durationMs: 180_000 }), { ok: true }, '정확히 180초·10MB는 저장된다');
  assert.deepEqual(checkRecordingFile({ byteSize: 1_000, durationMs: 181_000 }), { ok: false, reason: 'too_long' });
  assert.deepEqual(checkRecordingFile({ byteSize: 0, durationMs: 500 }), { ok: false, reason: 'empty' });
});

test('reading.recording: 소리가 들어 있을 수 없을 만큼 작은 파일은 비었다고 보고 올리지 않는다', () => {
  // 0.1.2 운영 녹음의 대부분이 소리 없는 258바이트 m4a 였다 — 머리만 있는 파일.
  assert.deepEqual(checkRecordingFile({ byteSize: 258, durationMs: 2_000, contentType: 'audio/mp4' }), { ok: false, reason: 'empty' });
  assert.deepEqual(checkRecordingFile({ byteSize: 44, durationMs: 2_000, contentType: 'audio/wav' }), { ok: false, reason: 'empty' });
  // 0.3초 미만으로 잡힌 녹음도 비었다고 본다.
  assert.deepEqual(checkRecordingFile({ byteSize: 50_000, durationMs: 200, contentType: 'audio/wav' }), { ok: false, reason: 'empty' });
  assert.deepEqual(checkRecordingFile({ byteSize: 20_000, durationMs: 1_000, contentType: 'audio/wav' }), { ok: true });
  assert.deepEqual(checkRecordingFile({ byteSize: 6_000, durationMs: 1_000, contentType: 'audio/mp4' }), { ok: true });
  // 길이를 모르면(0) 크기만 본다.
  assert.deepEqual(checkRecordingFile({ byteSize: 6_000, durationMs: 0, contentType: 'audio/mp4' }), { ok: true });
});

test('reading.recording: 같은 줄을 다시 말하면 시도 번호가 1씩 는다', () => {
  const attempts = {};
  assert.equal(nextAttemptNo(attempts, 'l1'), 1);
  attempts.l1 = 1;
  assert.equal(nextAttemptNo(attempts, 'l1'), 2);
  assert.equal(nextAttemptNo(attempts, 'l2'), 1);
});

test('reading.recording: 같은 줄 녹음은 attempt_no 가 가장 큰 것 하나만 — 받은 순서와 상관없이', () => {
  const recs = [
    { id: 'a2', line_id: 'l1', attempt_no: 2 },
    { id: 'b1', line_id: 'l2', attempt_no: 1 },
    { id: 'a3', line_id: 'l1', attempt_no: 3 },
    { id: 'a1', line_id: 'l1', attempt_no: 1 },
  ];
  const latest = latestRecordings(recs);
  assert.deepEqual([...latest.entries()].map(([line, r]) => [line, r.id]), [['l1', 'a3'], ['l2', 'b1']]);
  assert.equal(latest.get('l3'), undefined);
});

test('reading.recording: 전사는 기기 STT 결과만 — STT 없으면 none·NULL, 인식이 비면 NULL. 대조(matched)는 보내지 않는다', () => {
  assert.deepEqual(transcriptFields({ sttUsed: false, text: '' }), { transcript: null, transcript_source: 'none' });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: '  ' }), { transcript: null, transcript_source: 'stt' });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: ' 여기 있을 줄 ' }), { transcript: '여기 있을 줄', transcript_source: 'stt' });
});
