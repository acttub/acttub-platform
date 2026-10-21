import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createSseParser } = await import("../src/lib/api/v2/sse.ts");
const { consumeCoachStream, streamFailureAction } = await import("../src/lib/api/v2/coach-stream.ts");
const { postIdempotentStream } = await import("../src/lib/api/v2/idempotency.ts");
const { ApiError } = await import("../src/lib/api/v2/errors.ts");

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function parse(chunks) {
  const events = [];
  const parser = createSseParser((e) => events.push(e));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
}

test("SSE: 기본 이벤트·주석·CRLF·CR", () => {
  const expected = [
    { event: "delta", data: '{"text":"안"}' },
    { event: "done", data: '{"a":1}' },
  ];
  const lf = ': ping\n\nevent: delta\ndata: {"text":"안"}\n\nevent: done\ndata: {"a":1}\n\n';
  assert.deepEqual(parse([lf]), expected);
  assert.deepEqual(parse([lf.replaceAll("\n", "\r\n")]), expected);
  assert.deepEqual(parse([lf.replaceAll("\n", "\r")]), expected);
});

test("SSE: 어디서 끊겨도 같은 이벤트", () => {
  const text = ': ping\r\n\r\nevent: delta\r\ndata: {"text":"가나"}\r\n\r\nevent: done\r\ndata: {"x":2}\r\n\r\n';
  const whole = parse([text]);
  assert.equal(whole.length, 2);
  for (let size = 1; size < 9; size += 1) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    assert.deepEqual(parse(chunks), whole, `size ${size}`);
  }
});

test("SSE: 여러 data 줄, 닫히지 않은 이벤트 버림, BOM", () => {
  assert.deepEqual(parse(["event: x\ndata: a\ndata: b\n\n"]), [{ event: "x", data: "a\nb" }]);
  assert.deepEqual(parse(['event: delta\ndata: {"text":"끊김"}\n']), []);
  assert.deepEqual(parse(["\ufeffdata: hi\n\n"]), [{ event: "message", data: "hi" }]);
});

const enc = new TextEncoder();
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function readerOf(text, size = 7, failAfter = false) {
  const bytes = enc.encode(text);
  let at = 0;
  return {
    async read() {
      if (at >= bytes.length) {
        if (failAfter) throw new TypeError("network lost");
        return { done: true };
      }
      const value = bytes.slice(at, at + size);
      at += size;
      return { done: false, value };
    },
  };
}

test("consumeCoachStream: 한글이 바이트 경계에서 잘려도 delta를 잇고 done을 결과로 낸다", async () => {
  const deltas = [];
  const body = `: ping\n\n${sse("delta", { text: "무엇을 " })}${sse("delta", { text: "기다려요?" })}${sse("done", { message: "최종" })}`;
  const outcome = await consumeCoachStream(readerOf(body), (t) => deltas.push(t));
  assert.equal(deltas.join(""), "무엇을 기다려요?");
  assert.deepEqual(outcome, { kind: "done", value: { message: "최종" } });
});

test("consumeCoachStream: error 이벤트와 끊김", async () => {
  assert.deepEqual(
    await consumeCoachStream(readerOf(sse("error", { status: 409, detail: "conversation_conflict" })), () => {}),
    { kind: "error", status: 409, detail: "conversation_conflict" },
  );
  assert.deepEqual(await consumeCoachStream(readerOf(sse("delta", { text: "일부" }), 5, true), () => {}), { kind: "dropped" });
  assert.deepEqual(await consumeCoachStream(readerOf(sse("delta", { text: "일부" })), () => {}), { kind: "dropped" });
});

test("streamFailureAction: 구버전·재시도 대상만 일반 호출로 돌린다", () => {
  for (const status of [404, 405, 501, 429]) assert.equal(streamFailureAction({ status }), "fallback");
  assert.equal(streamFailureAction({ status: 409, code: "request is still processing" }), "fallback");
  assert.equal(streamFailureAction({ status: 0, network: true }), "fallback");
  for (const [status, code] of [[409, "conversation_conflict"], [409, "conversation_closed"], [409, "analysis_not_ready"], [422, "request_fingerprint_mismatch"], [502, "coach_response_unavailable"]]) {
    assert.equal(streamFailureAction({ status, code }), "throw", `${status} ${code}`);
  }
});

// ── postIdempotentStream (가짜 fetch) ──
function sseResponse(text, status = 200) {
  const bytes = enc.encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": "text/event-stream" } },
  );
}
const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

function fakeFetch({ stream, plain }) {
  const calls = { stream: [], plain: [] };
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    const call = { path, body: options.body, requestId: options.headers.get("X-Request-Id") };
    if (path.endsWith("/stream")) {
      calls.stream.push(call);
      return stream(calls.stream.length);
    }
    calls.plain.push(call);
    return plain(calls.plain.length);
  };
  return calls;
}
function immediateTimers() {
  globalThis.setTimeout = (cb, delay, ...args) => originalSetTimeout(cb, delay > 1000 ? 0 : delay, ...args);
}
const run = (extra = {}) =>
  postIdempotentStream("/v2/coach/reply/stream", "/v2/coach/reply", { text: "답" }, { requestId: "rid-1", ...extra });

test("스트림 성공: delta 콜백, done 값 사용, 일반 호출 없음", async () => {
  const deltas = [];
  const calls = fakeFetch({
    stream: () => sseResponse(`${sse("delta", { text: "가" })}${sse("delta", { text: "나" })}${sse("done", { message: "최종" })}`),
    plain: () => json({}, 500),
  });
  const response = await run({ onDelta: (t) => deltas.push(t) });
  assert.deepEqual(response.data, { message: "최종" });
  assert.deepEqual(deltas, ["가", "나"]);
  assert.equal(calls.plain.length, 0);
  assert.equal(calls.stream[0].requestId, "rid-1");
});

test("404/405 → 같은 request_id·본문으로 일반 호출", async () => {
  for (const status of [404, 405]) {
    const calls = fakeFetch({ stream: () => json({ detail: "nf" }, status), plain: () => json({ message: "일반" }) });
    const response = await run();
    assert.deepEqual(response.data, { message: "일반" });
    assert.equal(calls.plain[0].requestId, "rid-1");
    assert.equal(calls.plain[0].body, calls.stream[0].body);
  }
});

test("시작 전 HTTP 오류는 일반 호출과 같은 ApiError", async () => {
  const calls = fakeFetch({ stream: () => json({ detail: "conversation_conflict" }, 409), plain: () => json({}) });
  const error = await run().catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "conversation_conflict");
  assert.equal(calls.plain.length, 0);
});

test("error 이벤트 → onReset 후 같은 ApiError, 일반 호출 없음", async () => {
  let resets = 0;
  const calls = fakeFetch({
    stream: () => sseResponse(`${sse("delta", { text: "일부" })}${sse("error", { status: 502, detail: "coach_response_unavailable" })}`),
    plain: () => json({}),
  });
  const error = await run({ onReset: () => (resets += 1) }).catch((e) => e);
  assert.equal(error.status, 502);
  assert.equal(error.code, "coach_response_unavailable");
  assert.equal(resets, 1);
  assert.equal(calls.plain.length, 0);
});

test("도중 끊김 → 같은 request_id 로 일반 호출, 처리 중 409 는 기다렸다 재시도", async () => {
  immediateTimers();
  let resets = 0;
  const calls = fakeFetch({
    stream: () => sseResponse(sse("delta", { text: "일부" })),
    plain: (n) => (n === 1 ? json({ detail: "request is still processing" }, 409) : json({ message: "저장된 결과" })),
  });
  const response = await run({ onReset: () => (resets += 1) });
  assert.deepEqual(response.data, { message: "저장된 결과" });
  assert.equal(resets, 1);
  assert.equal(calls.stream.length, 1);
  assert.equal(calls.plain.length, 2);
  assert.ok(calls.plain.every((c) => c.requestId === "rid-1"));
});

test("200 인데 이벤트 스트림이 아니면 그 응답을 일반 응답으로 쓴다", async () => {
  const calls = fakeFetch({ stream: () => json({ message: "본문" }), plain: () => json({ message: "일반" }) });
  const response = await run();
  assert.deepEqual(response.data, { message: "본문" });
  assert.equal(calls.plain.length, 0);
});

test("연결 실패(fetch TypeError) → 일반 호출", async () => {
  immediateTimers();
  const calls = fakeFetch({ stream: () => { throw new TypeError("offline"); }, plain: () => json({ message: "일반" }) });
  const response = await run();
  assert.deepEqual(response.data, { message: "일반" });
  assert.equal(calls.plain.length, 1);
});

test("SSE: 콜론 없는 필드 줄은 값이 빈 필드다", () => {
  assert.deepEqual(parse(["data\n\n"]), [{ event: "message", data: "" }]);
  assert.deepEqual(parse(["event\ndata: 본문\n\n"]), [{ event: "message", data: "본문" }]);
});

test("consumeCoachStream: 깨진 delta 하나는 건너뛰고 뒤의 글을 잇는다", async () => {
  const deltas = [];
  const body = `event: delta\ndata: {"text":\n\n${sse("delta", { text: "이어서" })}${sse("done", { message: "끝" })}`;
  const outcome = await consumeCoachStream(readerOf(body), (t) => deltas.push(t));
  assert.deepEqual(deltas, ["이어서"]);
  assert.deepEqual(outcome, { kind: "done", value: { message: "끝" } });
});

test("consumeCoachStream: done 을 읽을 수 없거나 객체가 아니면 끊긴 것으로 본다", async () => {
  assert.deepEqual(await consumeCoachStream(readerOf("event: done\ndata: {깨짐\n\n"), () => {}), { kind: "dropped" });
  assert.deepEqual(await consumeCoachStream(readerOf(sse("done", "문자열")), () => {}), { kind: "dropped" });
  assert.deepEqual(await consumeCoachStream(readerOf(sse("done", null)), () => {}), { kind: "dropped" });
});

test("consumeCoachStream: 상태가 없는 error 이벤트는 500 으로 다룬다", async () => {
  assert.deepEqual(await consumeCoachStream(readerOf(sse("error", null)), () => {}), {
    kind: "error",
    status: 500,
    detail: undefined,
  });
  assert.deepEqual(await consumeCoachStream(readerOf(sse("error", { status: "409", detail: "x" })), () => {}), {
    kind: "error",
    status: 500,
    detail: "x",
  });
});

test("consumeCoachStream: 결과가 정해진 뒤 같은 조각에 실려 온 이벤트는 무시한다", async () => {
  const deltas = [];
  const body = `${sse("done", { message: "최종" })}${sse("delta", { text: "늦은 조각" })}${sse("error", { status: 502 })}`;
  const outcome = await consumeCoachStream(readerOf(body, body.length * 4), (t) => deltas.push(t));
  assert.deepEqual(outcome, { kind: "done", value: { message: "최종" } });
  assert.deepEqual(deltas, []);
});

test("consumeCoachStream: 빈 글·글이 아닌 delta 는 말풍선에 붙이지 않는다", async () => {
  const deltas = [];
  const body = `${sse("delta", { text: "" })}${sse("delta", { text: 3 })}${sse("delta", null)}${sse("delta", { text: "가" })}${sse("done", {})}`;
  await consumeCoachStream(readerOf(body), (t) => deltas.push(t));
  assert.deepEqual(deltas, ["가"]);
});
