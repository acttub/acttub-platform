import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECORDING_MAX_BYTES,
  RECORDING_MAX_MS,
  checkRecordingFile,
  contentTypeFor,
  fileNameFor,
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

test('reading.recording: 같은 줄을 다시 말하면 시도 번호가 1씩 는다', () => {
  const attempts = {};
  assert.equal(nextAttemptNo(attempts, 'l1'), 1);
  attempts.l1 = 1;
  assert.equal(nextAttemptNo(attempts, 'l1'), 2);
  assert.equal(nextAttemptNo(attempts, 'l2'), 1);
});

test('reading.recording: 전사·대조는 기기 STT 결과만 — STT 없으면 none·NULL, 인식 불가면 matched NULL, 미달 false, 통과 true', () => {
  assert.deepEqual(transcriptFields({ sttUsed: false, text: '', match: null }), { transcript: null, transcript_source: 'none', matched: null });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: '', match: { kind: 'no_speech' } }), { transcript: null, transcript_source: 'stt', matched: null });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: '여기 있을 줄', match: { kind: 'miss', closeness: 0.3 } }), { transcript: '여기 있을 줄', transcript_source: 'stt', matched: false });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: '여기 있을 줄 알았어', match: { kind: 'pass', closeness: 0.9 } }), { transcript: '여기 있을 줄 알았어', transcript_source: 'stt', matched: true });
  assert.deepEqual(transcriptFields({ sttUsed: true, text: '긴 말', match: { kind: 'too_long' } }), { transcript: '긴 말', transcript_source: 'stt', matched: null });
});
