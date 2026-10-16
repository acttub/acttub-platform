import assert from 'node:assert/strict';
import test from 'node:test';

import { createSseParser, createUtf8StreamDecoder } from '../lib/sse.ts';
import { consumeCoachStream, streamFailureAction } from '../lib/coach-stream.ts';
import { ApiError, createApiRequestClient } from '../lib/api-request.ts';

function parse(chunks) {
  const events = [];
  const parser = createSseParser((e) => events.push(e));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
}

test('SSE: 기본 이벤트·주석·CRLF·CR', () => {
  const expected = [
    { event: 'delta', data: '{"text":"안"}' },
    { event: 'done', data: '{"a":1}' },
  ];
  const lf = ': ping\n\nevent: delta\ndata: {"text":"안"}\n\nevent: done\ndata: {"a":1}\n\n';
  assert.deepEqual(parse([lf]), expected);
  assert.deepEqual(parse([lf.replaceAll('\n', '\r\n')]), expected);
  assert.deepEqual(parse([lf.replaceAll('\n', '\r')]), expected);
});

test('SSE: 줄 중간·이벤트 중간·\\r\\n 사이에서 끊겨도 같다', () => {
  const text = ': ping\r\n\r\nevent: delta\r\ndata: {"text":"가나"}\r\n\r\nevent: done\r\ndata: {"x":2}\r\n\r\n';
  const whole = parse([text]);
  for (let size = 1; size < 9; size += 1) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    assert.deepEqual(parse(chunks), whole, `size ${size}`);
  }
  assert.equal(whole.length, 2);
});

test('SSE: 여러 data 줄은 \\n 으로 잇고, 닫히지 않은 이벤트는 버린다', () => {
  assert.deepEqual(parse(['event: x\ndata: a\ndata: b\n\n']), [{ event: 'x', data: 'a\nb' }]);
  assert.deepEqual(parse(['event: delta\ndata: {"text":"끊김"}\n']), []);
  assert.deepEqual(parse(['\ufeffdata: hi\n\n']), [{ event: 'message', data: 'hi' }]);
});

test('UTF-8 디코더: 한글이 청크 경계에서 잘려도 깨지지 않는다', () => {
  const bytes = new TextEncoder().encode('안녕하세요 😀');
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const decoder = createUtf8StreamDecoder();
    assert.equal(decoder.decode(bytes.slice(0, cut)) + decoder.decode(bytes.slice(cut)) + decoder.flush(), '안녕하세요 😀');
  }
});

function readerOf(text, size = 7, failAfter = false) {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return {
    async read() {
      if (at >= bytes.length) {
        if (failAfter) throw new TypeError('network lost');
        return { done: true };
      }
      const value = bytes.slice(at, at + size);
      at += size;
      return { done: false, value };
    },
  };
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('consumeCoachStream: delta를 이어 주고 done을 결과로 낸다', async () => {
  const deltas = [];
  const body = `: ping\n\n${sse('delta', { text: '무엇을 ' })}${sse('delta', { text: '기다려요?' })}${sse('done', { message: '최종' })}`;
  const outcome = await consumeCoachStream(readerOf(body), (t) => deltas.push(t));
  assert.deepEqual(deltas, ['무엇을 ', '기다려요?']);
  assert.deepEqual(outcome, { kind: 'done', value: { message: '최종' } });
});

test('consumeCoachStream: error 이벤트와 끊김', async () => {
  const err = await consumeCoachStream(readerOf(sse('error', { status: 409, detail: 'conversation_conflict' })), () => {});
  assert.deepEqual(err, { kind: 'error', status: 409, detail: 'conversation_conflict' });
  const cut = await consumeCoachStream(readerOf(sse('delta', { text: '일부' }), 5, true), () => {});
  assert.deepEqual(cut, { kind: 'dropped' });
  const eof = await consumeCoachStream(readerOf(sse('delta', { text: '일부' })), () => {});
  assert.deepEqual(eof, { kind: 'dropped' });
});

test('streamFailureAction: 구버전·재시도 대상만 일반 호출로 돌린다', () => {
  for (const status of [404, 405, 501, 429]) assert.equal(streamFailureAction({ status }), 'fallback');
  assert.equal(streamFailureAction({ status: 409, code: 'request is still processing' }), 'fallback');
  assert.equal(streamFailureAction({ status: 0, name: 'NetworkError' }), 'fallback');
  for (const [status, code] of [[409, 'conversation_conflict'], [409, 'conversation_closed'], [409, 'analysis_not_ready'], [422, 'request_fingerprint_mismatch'], [502, 'coach_response_unavailable'], [401, 'unauthorized']]) {
    assert.equal(streamFailureAction({ status, code }), 'throw', `${status} ${code}`);
  }
});

// ── 클라이언트 통합(가짜 fetch) ──
function sseResponse(text, status = 200) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } },
  );
}
const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

function makeClient({ stream, plain }) {
  const calls = { stream: [], plain: [] };
  const client = createApiRequestClient({
    baseUrl: 'https://api.test',
    clientHeader: 'app/test',
    fetchImpl: async (url, init) => {
      calls.plain.push({ path: new URL(url).pathname, headers: new Headers(init.headers), body: init.body });
      return plain(calls.plain.length);
    },
    streamFetchImpl: stream
      ? async (url, init) => {
          calls.stream.push({ path: new URL(url).pathname, headers: new Headers(init.headers), body: init.body });
          return stream(calls.stream.length);
        }
      : undefined,
    waitForCredentialReady: async () => {},
    getAccessToken: () => 'tok',
    getRefreshToken: () => 'ref',
    getAuthSessionEpoch: () => 0,
    setTokens: async () => 'refreshed',
    clearTokens: async () => true,
    emitConsentRequired: () => {},
    emitProfileRequired: () => {},
    emitAccountDeactivated: () => {},
    emitUpdateRequired: () => {},
    clock: { now: () => Date.now(), setTimeout: (cb) => setTimeout(cb, 0), clearTimeout },
  });
  return { client, calls };
}

const run = (client, extra = {}) =>
  client.postIdempotentStream('/v2/coach/reply/stream', '/v2/coach/reply', { text: '답' }, { requestId: 'rid-1', ...extra });

test('스트림 성공: delta 콜백, done 값 사용, 일반 호출 없음, 같은 헤더', async () => {
  const deltas = [];
  const { client, calls } = makeClient({
    stream: () => sseResponse(`${sse('delta', { text: '가' })}${sse('delta', { text: '나' })}${sse('done', { message: '최종' })}`),
    plain: () => json({}, 500),
  });
  const result = await run(client, { onDelta: (t) => deltas.push(t) });
  assert.deepEqual(result, { message: '최종' });
  assert.deepEqual(deltas, ['가', '나']);
  assert.equal(calls.plain.length, 0);
  assert.equal(calls.stream[0].path, '/v2/coach/reply/stream');
  assert.equal(calls.stream[0].headers.get('Authorization'), 'Bearer tok');
  assert.equal(calls.stream[0].headers.get('X-Request-Id'), 'rid-1');
});

test('404/405 → 같은 request_id 로 일반 호출', async () => {
  for (const status of [404, 405]) {
    const { client, calls } = makeClient({ stream: () => json({ detail: 'nf' }, status), plain: () => json({ message: '일반' }) });
    assert.deepEqual(await run(client), { message: '일반' });
    assert.equal(calls.plain[0].path, '/v2/coach/reply');
    assert.equal(calls.plain[0].headers.get('X-Request-Id'), 'rid-1');
    assert.equal(calls.plain[0].body, calls.stream[0].body);
  }
});

test('스트림 없는 환경(streamFetchImpl 없음) → 일반 호출', async () => {
  const { client, calls } = makeClient({ plain: () => json({ message: '일반' }) });
  assert.deepEqual(await run(client), { message: '일반' });
  assert.equal(calls.plain.length, 1);
});

test('시작 전 HTTP 오류는 일반 호출과 같은 ApiError, 일반 호출 없음', async () => {
  const { client, calls } = makeClient({ stream: () => json({ detail: 'conversation_conflict' }, 409), plain: () => json({}) });
  const error = await run(client).catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.code, 'conversation_conflict');
  assert.equal(calls.plain.length, 0);
});

test('error 이벤트 → 거품 버리고(onReset) 같은 ApiError, 일반 호출 없음', async () => {
  let resets = 0;
  const { client, calls } = makeClient({
    stream: () => sseResponse(`${sse('delta', { text: '일부' })}${sse('error', { status: 502, detail: 'coach_response_unavailable' })}`),
    plain: () => json({}),
  });
  const error = await run(client, { onReset: () => (resets += 1) }).catch((e) => e);
  assert.equal(error.status, 502);
  assert.equal(error.code, 'coach_response_unavailable');
  assert.equal(resets, 1);
  assert.equal(calls.plain.length, 0);
});

test('error 이벤트 409 conversation_closed 도 그대로 던진다', async () => {
  const { client } = makeClient({ stream: () => sseResponse(sse('error', { status: 409, detail: 'conversation_closed' })), plain: () => json({}) });
  const error = await run(client).catch((e) => e);
  assert.equal(error.code, 'conversation_closed');
});

test('도중 끊김(done 없음) → 같은 request_id 로 일반 호출 한 번, 처리 중 409 는 기다렸다 재시도', async () => {
  let resets = 0;
  const { client, calls } = makeClient({
    stream: () => sseResponse(sse('delta', { text: '일부' })),
    plain: (n) => (n === 1 ? json({ detail: 'request is still processing' }, 409) : json({ message: '저장된 결과' })),
  });
  const result = await run(client, { onReset: () => (resets += 1), deadlineMs: 20_000 });
  assert.deepEqual(result, { message: '저장된 결과' });
  assert.equal(resets, 1);
  assert.equal(calls.stream.length, 1);
  assert.equal(calls.plain.length, 2);
  assert.ok(calls.plain.every((c) => c.headers.get('X-Request-Id') === 'rid-1'));
});

test('200 인데 이벤트 스트림이 아니면 일반 호출', async () => {
  const { client, calls } = makeClient({ stream: () => json({ message: '프록시가 바꾼 본문' }), plain: () => json({ message: '일반' }) });
  assert.deepEqual(await run(client), { message: '일반' });
  assert.equal(calls.plain.length, 1);
});

test('연결 실패(fetch 예외) → 일반 호출', async () => {
  const { client, calls } = makeClient({ stream: () => { throw new TypeError('offline'); }, plain: () => json({ message: '일반' }) });
  assert.deepEqual(await run(client), { message: '일반' });
  assert.equal(calls.plain.length, 1);
});
