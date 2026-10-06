import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, NetworkError } from '../lib/api-request.ts';
import { scriptErrorCodeOf, scriptErrorMessage, scriptSaveAlert } from '../lib/reading/script-errors.ts';

const unprocessable = (code) => new ApiError(422, 'raw message', code, code, { detail: code });

test('reading.script: 한도·규칙 422의 사유 코드마다 화면 문구가 있다', () => {
  assert.match(scriptErrorMessage(unprocessable('script_too_long')), /100,000자/);
  assert.match(scriptErrorMessage(unprocessable('script_limit')), /100개/);
  assert.match(scriptErrorMessage(unprocessable('no_characters')), /말하는 사람 이름/);
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

test('reading.script: 대본 넣기 위 알림 — 배역을 못 찾으면 그 알림, 나머지는 「저장」 알림', () => {
  assert.deepEqual(scriptSaveAlert('no_characters'), {
    title: '배역을 찾지 못했어요',
    message: '대본에 말하는 사람 이름이 있는지 확인하고 다시 넣어 주세요.',
  });
  assert.deepEqual(scriptSaveAlert(unprocessable('no_characters')), scriptSaveAlert('no_characters'), '서버가 거절해도 같은 알림');
  assert.deepEqual(scriptSaveAlert(unprocessable('script_limit')), {
    title: '저장',
    message: '대본은 100개까지 둘 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요.',
  });
  const network = new NetworkError();
  assert.deepEqual(scriptSaveAlert(network), { title: '저장', message: network.message });
});
