import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import {
  DEFAULT_MEMORY_CHOICE,
  createGuestTransfer,
  formatTransferCodeInput,
  isTransferCodeComplete,
  transferRequestBody,
} from '../lib/guest-transfer.ts';

const apiError = (status, code, detail = code) => new ApiError(status, code, code, detail);

/** 서버 흉내. 회원과 게스트 둘 다 배우 기억이 있는 상황을 만들 수 있다. */
function fakeServer({ code = '482913', bothHaveMemory = false } = {}) {
  const state = { requests: [], liveCode: code, transferred: [], keptMemory: null };
  return {
    state,
    send: async (body) => {
      state.requests.push(body);
      if (body.code !== state.liveCode) throw apiError(404, 'transfer_code_not_found');
      if (bothHaveMemory && !body.memory_choice) throw apiError(409, 'memory_choice_required');
      state.keptMemory = body.memory_choice ?? null;
      state.transferred.push(body.code);
      state.liveCode = null; // 한 번 쓰면 끝
      return { transferred: true };
    },
  };
}

test('account.guest: 이관 코드는 숫자 여섯 자리만 받는다', () => {
  assert.equal(formatTransferCodeInput('48 29-13'), '482913');
  assert.equal(formatTransferCodeInput('4829135'), '482913');
  assert.equal(formatTransferCodeInput('abc'), '');
  assert.equal(isTransferCodeComplete('482913'), true);
  assert.equal(isTransferCodeComplete('48291'), false);
  assert.equal(isTransferCodeComplete('48291a'), false);
});

test('account.guest: memory_choice는 409를 받은 뒤에만 싣는다', () => {
  assert.deepEqual(transferRequestBody('482913'), { code: '482913' });
  assert.deepEqual(transferRequestBody('482913', 'guest'), {
    code: '482913',
    memory_choice: 'guest',
  });
});

test('account.guest: 게스트로 연습을 끝내고 코드를 앱에서 입력하면 옮겨진다', async () => {
  const server = fakeServer();
  const transfer = createGuestTransfer({ send: server.send });

  assert.deepEqual(await transfer.submit('482913'), { kind: 'transferred' });
  assert.deepEqual(server.state.requests, [{ code: '482913' }]);
});

test('account.guest: 기억이 둘 다 있으면 팝업이 뜨고, 고르기 전에는 아무것도 옮겨지지 않는다', async () => {
  const server = fakeServer({ bothHaveMemory: true });
  const transfer = createGuestTransfer({ send: server.send });

  assert.deepEqual(await transfer.submit('482913'), { kind: 'memory_choice_required' });

  assert.deepEqual(server.state.transferred, []);
  assert.equal(server.state.liveCode, '482913', '409는 코드를 소진하지 않는다');
});

test('account.guest: 팝업에서 웹 것을 고르면 같은 코드에 memory_choice를 실어 다시 보내고 옮겨진다', async () => {
  const server = fakeServer({ bothHaveMemory: true });
  const transfer = createGuestTransfer({ send: server.send });

  await transfer.submit('482913');
  assert.deepEqual(await transfer.choose('guest'), { kind: 'transferred' });

  assert.deepEqual(server.state.requests, [
    { code: '482913' },
    { code: '482913', memory_choice: 'guest' },
  ]);
  assert.equal(server.state.keptMemory, 'guest');
});

test('account.guest: 팝업의 기본은 회원 것이고, 회원 것을 고르면 게스트 기억은 버려진다', async () => {
  assert.equal(DEFAULT_MEMORY_CHOICE, 'member');

  const server = fakeServer({ bothHaveMemory: true });
  const transfer = createGuestTransfer({ send: server.send });
  await transfer.submit('482913');
  await transfer.choose(DEFAULT_MEMORY_CHOICE);

  assert.equal(server.state.keptMemory, 'member');
});

test('account.guest: 팝업을 닫으면 아무것도 옮겨지지 않고 같은 코드를 다시 쓸 수 있다', async () => {
  const server = fakeServer({ bothHaveMemory: true });
  const transfer = createGuestTransfer({ send: server.send });
  await transfer.submit('482913');

  transfer.dismiss();

  assert.equal(server.state.requests.length, 1, '닫기는 요청을 보내지 않는다');
  assert.deepEqual(server.state.transferred, []);
  // 닫은 뒤에는 고를 것이 없다.
  await assert.rejects(transfer.choose('guest'));
  // 같은 코드를 10분 안에 다시 넣으면 다시 팝업부터다.
  assert.deepEqual(await transfer.submit('482913'), { kind: 'memory_choice_required' });
});

test('account.guest: 코드가 틀리거나 만료·사용됐으면 같은 안내다 — "코드가 맞지 않거나 만료됐어요"', async () => {
  const server = fakeServer();
  const transfer = createGuestTransfer({ send: server.send });

  assert.deepEqual(await transfer.submit('000000'), { kind: 'code_not_found' });
  // 같은 코드를 다시 입력: 이미 썼으므로 404.
  await transfer.submit('482913');
  assert.deepEqual(await transfer.submit('482913'), { kind: 'code_not_found' });
});

test('account.guest: 틀린 시도가 몰려 429를 받으면 잠시 뒤 다시 시도하라고 안내한다', async () => {
  const transfer = createGuestTransfer({
    send: async () => {
      throw apiError(429, 'rate limit exceeded');
    },
  });

  assert.deepEqual(await transfer.submit('482913'), { kind: 'rate_limited' });
});

test('account.guest: 옮기기 도중 실패하면 코드는 살아 있어 같은 코드로 다시 성공한다', async () => {
  let attempts = 0;
  const server = fakeServer();
  const transfer = createGuestTransfer({
    send: async (body) => {
      attempts += 1;
      if (attempts === 1) throw apiError(500, 'internal_server_error');
      return server.send(body);
    },
  });

  assert.equal((await transfer.submit('482913')).kind, 'retry');
  assert.deepEqual(await transfer.submit('482913'), { kind: 'transferred' });
});

test('account.guest: 한 회원이 게스트 둘을 차례로 옮길 수 있다', async () => {
  const codes = new Set(['111111', '222222']);
  const moved = [];
  const transfer = createGuestTransfer({
    send: async (body) => {
      if (!codes.delete(body.code)) throw apiError(404, 'transfer_code_not_found');
      moved.push(body.code);
      return { transferred: true };
    },
  });

  assert.deepEqual(await transfer.submit('111111'), { kind: 'transferred' });
  assert.deepEqual(await transfer.submit('222222'), { kind: 'transferred' });
  assert.deepEqual(moved, ['111111', '222222']);
});

test('account.guest: 여섯 자리가 아닌 코드는 서버에 보내지 않고, 본문 모양 422는 앱 버그로 다룬다', async () => {
  let sent = 0;
  const transfer = createGuestTransfer({
    send: async () => {
      sent += 1;
      throw new ApiError(422, 'x', 'validation_error', [{ loc: ['body', 'code'] }]);
    },
  });

  assert.deepEqual(await transfer.submit('12345'), { kind: 'code_not_found' });
  assert.equal(sent, 0);
  assert.deepEqual(await transfer.submit('123456'), { kind: 'client_bug' });
});

test('account.guest: 틀린 코드의 화면 문구는 "코드가 맞지 않거나 만료됐어요"다', async () => {
  const { default: ko } = await import('../locales/ko.ts');

  assert.equal(ko.guestTransfer.codeNotFound, '코드가 맞지 않거나 만료됐어요');
  assert.match(ko.guestTransfer.rateLimited, /잠시 뒤 다시 시도/);
});
