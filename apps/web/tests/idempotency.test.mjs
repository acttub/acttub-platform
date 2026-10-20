// 멱등 POST 의 기한·취소 갈래. 기본 재시도 규칙은 v2-idempotency.test.mjs, 스트림의 기본 갈래는
// coach-stream.test.mjs 가 본다. 여기서는 기한이 다 됐을 때 무엇을 돌려주는지, 기다리는 사이에
// 취소하면 어떻게 끝나는지, 동의 시트가 다른 요청 때문에 떠 있던 시간도 기한에서 빠지는지를 본다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { postIdempotent, postIdempotentStream } = await import("../src/lib/api/v2/idempotency.ts");
const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { registerConsentPrompt } = await import("../src/lib/api/v2/consent-prompt.ts");

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalTextDecoder = globalThis.TextDecoder;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  globalThis.TextDecoder = originalTextDecoder;
});

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const enc = new TextEncoder();
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** 실제 fetch 처럼 요청의 signal 이 끊기면 본문 읽기도 끊기는 이벤트 스트림 응답. 닫지 않고 열어 둔다. */
function openSseResponse(text, signal) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(text));
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const call = {
      path: String(url),
      method: options.method,
      body: options.body,
      requestId: options.headers.get("X-Request-Id"),
      contentType: options.headers.get("Content-Type"),
    };
    calls.push(call);
    return handler(call, calls.length, options);
  };
  return calls;
}

const hangUntilAborted = (options) =>
  new Promise((_resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason);
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });

test("기한이 처음부터 남아 있지 않으면 서버에 보내지 않고 TimeoutError 로 끝난다", async () => {
  const calls = recordFetch(() => json({ ok: true }));

  const error = await postIdempotent("/v2/example", { a: 1 }, { requestId: "r-0", deadlineMs: 0 }).catch((e) => e);

  assert.equal(error.name, "TimeoutError");
  assert.equal(error.message, "멱등 요청 처리 기한을 초과했습니다.");
  assert.deepEqual(calls, []);
});

test("처리 중(409)을 기다리다 기한이 다 되면 마지막으로 받은 409 를 돌려준다", async () => {
  const calls = recordFetch(() => json({ detail: "request is still processing" }, 409));

  const error = await postIdempotent("/v2/example", { a: 1 }, { requestId: "r-409", deadlineMs: 30 }).catch((e) => e);

  assert.equal(error.status, 409);
  assert.equal(error.code, "request is still processing");
  assert.deepEqual(calls.map((c) => c.requestId), ["r-409"]);
});

test("재시도를 기다리는 사이 호출자가 취소하면 다시 보내지 않고 그 취소 사유로 끝난다", async () => {
  const controller = new AbortController();
  const calls = recordFetch(() => {
    // 응답을 돌려준 직후(재시도 대기에 들어갈 때) 취소한다.
    setTimeout(() => controller.abort(new DOMException("화면을 떠났다", "AbortError")), 5);
    return json({ detail: "request is still processing" }, 409);
  });

  const error = await postIdempotent(
    "/v2/example",
    { a: 1 },
    { requestId: "r-abort", signal: controller.signal, deadlineMs: 10_000 },
  ).catch((e) => e);

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "화면을 떠났다");
  assert.equal(calls.length, 1);
});

test("이미 취소된 signal 로 부르면 그 취소 사유로 끝나고 다시 보내지 않는다", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("이미 취소", "AbortError"));
  const calls = recordFetch((_call, _n, options) => hangUntilAborted(options));

  const error = await postIdempotent(
    "/v2/example",
    { a: 1 },
    { requestId: "r-pre", signal: controller.signal, deadlineMs: 10_000 },
  ).catch((e) => e);

  assert.equal(error.message, "이미 취소");
  // fetch 는 이미 끊긴 signal 을 받아 곧바로 끊는다.
  assert.deepEqual(calls.map((c) => c.requestId), ["r-pre"]);
});

test("409 를 받는 순간 이미 취소돼 있으면 기다리지 않고 그 취소 사유로 끝난다", async () => {
  const controller = new AbortController();
  const calls = recordFetch(() => {
    controller.abort(new DOMException("응답 직전에 떠났다", "AbortError"));
    return json({ detail: "request is still processing" }, 409);
  });

  const error = await postIdempotent(
    "/v2/example",
    { a: 1 },
    { requestId: "r-abort-now", signal: controller.signal, deadlineMs: 10_000 },
  ).catch((e) => e);

  assert.equal(error.message, "응답 직전에 떠났다");
  assert.equal(calls.length, 1);
});

test("취소되지 않은 signal 을 들고 재시도하면 기다린 뒤 같은 request id 로 다시 보내 결과를 받는다", async () => {
  const controller = new AbortController();
  const calls = recordFetch((_call, n) =>
    n === 1 ? json({ detail: "rate limit exceeded" }, 429) : json({ saved: true }, 201),
  );
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, delay, ...args) => originalSetTimeout(cb, delay > 1000 ? 0 : delay, ...args);

  try {
    const response = await postIdempotent(
      "/v2/example",
      { a: 1 },
      { requestId: "r-signal", signal: controller.signal, deadlineMs: 10_000 },
    );
    assert.deepEqual(response, { status: 201, data: { saved: true } });
    assert.deepEqual(calls.map((c) => c.requestId), ["r-signal", "r-signal"]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("처리 중 409 를 받았을 때 기한이 이미 지났으면 기다리지 않고 그 409 를 돌려준다", async () => {
  const calls = recordFetch(() => {
    const late = originalNow() + 1_000;
    Date.now = () => late;
    return json({ detail: "request is still processing" }, 409);
  });

  const error = await postIdempotent("/v2/example", { a: 1 }, { requestId: "r-late", deadlineMs: 50 }).catch((e) => e);

  assert.equal(error.status, 409);
  assert.equal(error.code, "request is still processing");
  assert.equal(calls.length, 1);
});

test("request id 를 주지 않으면 UUID 를 만들어 재시도에도 그대로 쓴다", async () => {
  const calls = recordFetch((_call, n) =>
    n === 1 ? json({ detail: "request is still processing" }, 409) : json({ saved: true }),
  );
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, delay, ...args) => originalSetTimeout(cb, delay > 1000 ? 0 : delay, ...args);

  try {
    await postIdempotent("/v2/example", { a: 1 });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(calls[1].requestId, calls[0].requestId);
});

test("취소 사유를 싣지 않는 옛 브라우저의 signal 이면 한국어 AbortError 로 끝난다", async () => {
  // AbortSignal.reason 이 없던 브라우저(Safari 15.4 이전)의 signal 모양.
  const legacySignal = new EventTarget();
  legacySignal.aborted = true;
  const calls = recordFetch((_call, _n, options) => hangUntilAborted(options));

  const error = await postIdempotent(
    "/v2/example",
    { a: 1 },
    { requestId: "r-legacy", signal: legacySignal, deadlineMs: 10_000 },
  ).catch((e) => e);

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "요청이 취소되었습니다.");
  assert.equal(calls.length, 1);
});

test("본문 없는 멱등 POST 는 본문·Content-Type 없이 request id 만 싣는다", async () => {
  const calls = recordFetch(() => json({ done: true }, 201));

  const response = await postIdempotent("/v2/example/close", undefined, { requestId: "r-empty" });

  assert.deepEqual(response, { status: 201, data: { done: true } });
  assert.deepEqual(calls, [
    { path: "/v2/example/close", method: "POST", body: undefined, requestId: "r-empty", contentType: null },
  ]);
});

test("account.guest: 다른 요청 때문에 동의 시트가 떠 있던 시간도 이 요청의 기한에서 뺀다", async () => {
  // A 는 응답이 오지 않는 멱등 요청(기한 100ms), B 는 동의가 빠져 시트를 60ms 띄운다. 시트가
  // 닫힌 뒤 A 의 타이머가 울려도 기한이 아직 남았으므로 남은 만큼 다시 잰다.
  globalThis.fetch = async (url, options) => {
    if (String(url) === "/v2/hanging") return hangUntilAborted(options);
    if (options.headers.get("X-Request-Id") === "b-retry") return json({ ok: true });
    return json(
      {
        detail: "consent_required",
        pending_consents: [
          { id: "t", type: "terms", version: "1", title: "약관", body: "전문", required: true, published_at: "2026-10-01T00:00:00Z" },
        ],
      },
      403,
    );
  };
  const unregister = registerConsentPrompt(
    () => new Promise((resolve) => setTimeout(() => resolve("dismissed"), 60)),
  );

  try {
    const startedAt = originalNow();
    const a = postIdempotent("/v2/hanging", { a: 1 }, { requestId: "a", deadlineMs: 100 }).catch((e) => e);
    const b = apiFetch("/v2/blocked", { method: "POST", body: {} }).catch((e) => e);

    const [aError, bError] = await Promise.all([a, b]);
    const elapsed = originalNow() - startedAt;

    assert.equal(bError.code, "consent_required");
    assert.equal(aError.name, "TimeoutError");
    // 시트 60ms 를 빼지 않았다면 100ms 에 끊겼다.
    assert.ok(elapsed >= 150, `기한이 시트 시간만큼 늘어야 한다(걸린 시간 ${elapsed}ms)`);
  } finally {
    unregister();
  }
});

// ── postIdempotentStream ──

const runStream = (extra = {}) =>
  postIdempotentStream("/v2/coach/reply/stream", "/v2/coach/reply", { text: "답" }, extra);

test("request_id 를 주지 않으면 하나를 만들어 스트림 시도와 일반 호출이 같이 쓴다", async () => {
  const calls = recordFetch((call) =>
    call.path.endsWith("/stream") ? json({ detail: "not found" }, 404) : json({ message: "일반" }),
  );

  const response = await postIdempotentStream("/v2/coach/reply/stream", "/v2/coach/reply", undefined);

  assert.deepEqual(response.data, { message: "일반" });
  assert.equal(calls.length, 2);
  assert.match(calls[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(calls[1].requestId, calls[0].requestId);
  assert.deepEqual(
    calls.map((c) => c.body),
    [undefined, undefined],
  );
});

test("스트림을 읽을 수 없는 브라우저는 처음부터 일반 경로만 부른다", async () => {
  globalThis.TextDecoder = undefined;
  const calls = recordFetch(() => json({ message: "일반" }));

  const response = await runStream({ requestId: "rid-nostream" });

  assert.deepEqual(response.data, { message: "일반" });
  assert.deepEqual(
    calls.map((c) => [c.path, c.requestId]),
    [["/v2/coach/reply", "rid-nostream"]],
  );
});

test("스트림 경로가 404 로 답했을 때 기한이 이미 다 됐으면 일반 호출 없이 TimeoutError", async () => {
  const resets = [];
  const calls = recordFetch(() => {
    // 서버가 늦게 답하는 사이 기한(50ms)이 지나간다.
    const late = originalNow() + 1_000;
    Date.now = () => late;
    return json({ detail: "not found" }, 404);
  });

  const error = await runStream({ requestId: "rid-late", deadlineMs: 50, onReset: () => resets.push("reset") }).catch(
    (e) => e,
  );

  assert.equal(error.name, "TimeoutError");
  assert.deepEqual(calls.map((c) => c.path), ["/v2/coach/reply/stream"]);
  assert.deepEqual(resets, ["reset"]);
});

test("error 이벤트가 429 면 쓰던 조각을 버리고 같은 request_id 로 일반 호출한다", async () => {
  const deltas = [];
  const resets = [];
  const calls = recordFetch((call) =>
    call.path.endsWith("/stream")
      ? new Response(enc.encode(`${sse("delta", { text: "쓰다" })}${sse("error", { status: 429 })}`), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      : json({ message: "저장된 결과" }),
  );

  const response = await runStream({
    requestId: "rid-429",
    onDelta: (t) => deltas.push(t),
    onReset: () => resets.push("reset"),
  });

  assert.deepEqual(response.data, { message: "저장된 결과" });
  assert.deepEqual(deltas, ["쓰다"]);
  assert.deepEqual(resets, ["reset"]);
  assert.deepEqual(
    calls.map((c) => [c.path, c.requestId]),
    [
      ["/v2/coach/reply/stream", "rid-429"],
      ["/v2/coach/reply", "rid-429"],
    ],
  );
});

test("받는 도중 호출자가 취소하면 일반 호출로 넘기지 않고 그 취소 사유로 끝난다", async () => {
  const controller = new AbortController();
  const deltas = [];
  const calls = recordFetch((_call, _n, options) => openSseResponse(sse("delta", { text: "일부" }), options.signal));

  const error = await runStream({
    requestId: "rid-cancel",
    signal: controller.signal,
    onDelta: (t) => {
      deltas.push(t);
      // 첫 조각을 그린 뒤 배우가 말풍선을 닫는다.
      controller.abort(new DOMException("말풍선을 닫았다", "AbortError"));
    },
  }).catch((e) => e);

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "말풍선을 닫았다");
  assert.deepEqual(deltas, ["일부"]);
  assert.deepEqual(calls.map((c) => c.path), ["/v2/coach/reply/stream"]);
});

test("받는 도중 기한이 다 되면 일반 호출로 넘기지 않고 TimeoutError", async () => {
  const calls = recordFetch((_call, _n, options) => openSseResponse(sse("delta", { text: "일부" }), options.signal));

  const error = await runStream({ requestId: "rid-deadline", deadlineMs: 20 }).catch((e) => e);

  assert.equal(error.name, "TimeoutError");
  assert.deepEqual(calls.map((c) => c.path), ["/v2/coach/reply/stream"]);
});
