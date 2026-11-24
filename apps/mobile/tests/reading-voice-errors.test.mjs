import assert from 'node:assert/strict';
import test from 'node:test';

import { playbackFailureFields, VoicePrepareError, voiceErrorKind } from '../lib/reading/tts/voice-errors.ts';

test('목소리 준비 실패 분류: 단계에서 붙인 종류를 그대로 쓴다', () => {
  for (const kind of ['network', 'storage', 'parse', 'model_load']) {
    assert.equal(voiceErrorKind(new VoicePrepareError(kind, 'x')), kind);
  }
});

test('목소리 준비 실패 분류: 종류가 없으면 메시지로 짐작한다', () => {
  assert.equal(voiceErrorKind(new SyntaxError('Unexpected token < in JSON')), 'parse');
  assert.equal(voiceErrorKind(new Error('Unable to download file: The network connection was lost.')), 'network');
  assert.equal(voiceErrorKind(new Error('java.net.SocketTimeoutException: timeout')), 'network');
  assert.equal(voiceErrorKind(new Error('Unable to resolve host "huggingface.co"')), 'network');
  assert.equal(voiceErrorKind(new Error('write failed: ENOSPC (No space left on device)')), 'storage');
  assert.equal(voiceErrorKind(new Error('weird')), 'unknown');
  assert.equal(voiceErrorKind(undefined), 'unknown');
  assert.equal(voiceErrorKind('offline'), 'unknown');
});

test('목소리 준비 실패: 필요한 용량을 함께 싣는다', () => {
  const e = new VoicePrepareError('storage', 'no space', { neededBytes: 123 });
  assert.equal(e.neededBytes, 123);
  assert.ok(e instanceof Error);
});

test('줄 재생 실패 기록(SOMA-1062): 재생기 실패와 시작 안 됨을 가르고, 그 밖은 other 다', () => {
  assert.deepEqual(playbackFailureFields(new VoicePrepareError('playback', '재생 실패: failed')), { reason: 'failed', message: '재생 실패: failed' });
  assert.deepEqual(playbackFailureFields(new VoicePrepareError('playback', '재생 실패: not_started')), { reason: 'not_started', message: '재생 실패: not_started' });
  assert.equal(playbackFailureFields(new Error('재생 실패: failed')).reason, 'other', '종류가 playback 이 아니면 문구만 같아도 가르지 않는다');
  assert.deepEqual(playbackFailureFields(new Error('player crashed')), { reason: 'other', message: 'player crashed' });
  assert.deepEqual(playbackFailureFields(undefined), { reason: 'other', message: '' });
});

test('줄 재생 실패 기록: 문구의 파일 경로는 지우고 100자로 자른다', () => {
  const { message } = playbackFailureFields(new Error('Cannot open file:///var/mobile/x/speech.wav at /private/tmp/a.wav'));
  assert.equal(message, 'Cannot open <path> at <path>');
  assert.equal(playbackFailureFields(new Error('가'.repeat(300))).message.length, 100);
});
