import assert from 'node:assert/strict';
import test from 'node:test';

import { VoicePrepareError, voiceErrorKind } from '../lib/reading/tts/voice-errors.ts';

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
