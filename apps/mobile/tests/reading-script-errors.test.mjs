import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { scriptErrorCodeOf, scriptErrorMessage } from '../lib/reading/script-errors.ts';

const unprocessable = (code) => new ApiError(422, 'raw message', code, code, { detail: code });

test('reading.script: 한도·규칙 422의 사유 코드마다 화면 문구가 있다', () => {
  assert.match(scriptErrorMessage(unprocessable('script_too_long')), /100,000자/);
  assert.match(scriptErrorMessage(unprocessable('script_limit')), /100개/);
  assert.match(scriptErrorMessage(unprocessable('no_characters')), /배역/);
  assert.match(scriptErrorMessage(unprocessable('invalid_characters')), /이름/);
  assert.match(scriptErrorMessage(unprocessable('request_fingerprint_mismatch')), /새 대본/);
});

test('reading.script: 기기 사전 검사의 코드 문자열도 같은 문구로 바꾼다', () => {
  assert.equal(scriptErrorMessage('script_limit'), scriptErrorMessage(unprocessable('script_limit')));
});

test('reading.script: 모르는 422·네트워크 오류는 공용 문구를 쓴다', () => {
  assert.equal(scriptErrorCodeOf(unprocessable('something_else')), null);
  assert.equal(scriptErrorMessage(unprocessable('something_else')), 'raw message');
  const network = new NetworkError();
  assert.equal(scriptErrorMessage(network), network.message);
  assert.equal(scriptErrorCodeOf(network), null);
});
