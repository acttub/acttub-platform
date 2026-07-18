import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { postIdempotent } = await import("../src/lib/api/v2/idempotency.ts");
const { NetworkError } = await import("../src/lib/api/v2/errors.ts");

const originalFetch = globalThis.fetch;
const originalRandom = Math.random;
const originalSetTimeout = globalThis.setTimeout;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withImmediateTimers(run) {
  globalThis.setTimeout = (callback, _delay, ...args) =>
    originalSetTimeout(callback, 0, ...args);
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  Math.random = originalRandom;
});

test("processing 재시도는 같은 request id와 body 문자열을 재사용한다", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push({
      body: options.body,
      requestId: options.headers.get("X-Request-Id"),
    });
    if (requests.length === 1) {
      return jsonResponse({ detail: "request is still processing" }, 409);
    }
    return jsonResponse({ completed: true });
  };

  const waits = [];
  const response = await withImmediateTimers(() =>
    postIdempotent(
      "/v2/example",
      { scene: "same", count: 1 },
      {
        requestId: "request-fixed",
        deadlineMs: 10_000,
        onWait: (info) => waits.push(info),
      },
    ),
  );

  assert.deepEqual(response.data, { completed: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.requestId), [
    "request-fixed",
    "request-fixed",
  ]);
  assert.equal(requests[0].body, JSON.stringify({ scene: "same", count: 1 }));
  assert.equal(requests[1].body, requests[0].body);
  assert.equal(waits[0].reason, "processing");
});

test("429 응답은 rate limit 대기 후 재시도한다", async () => {
  let fetchCount = 0;
  Math.random = () => 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? jsonResponse({ detail: "rate limit exceeded" }, 429)
      : jsonResponse({ completed: true });
  };

  const waits = [];
  await withImmediateTimers(() =>
    postIdempotent(
      "/v2/example",
      { scene: "rate-limited" },
      { requestId: "request-rate", deadlineMs: 10_000, onWait: (info) => waits.push(info) },
    ),
  );

  assert.equal(fetchCount, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(
    { reason: waits[0].reason, attempt: waits[0].attempt, delayMs: waits[0].delayMs },
    { reason: "rate_limited", attempt: 1, delayMs: 2000 },
  );
});

test("request fingerprint 불일치는 즉시 throw한다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return jsonResponse({ detail: "request_fingerprint_mismatch" }, 422);
  };

  await assert.rejects(
    postIdempotent(
      "/v2/example",
      { scene: "mismatch" },
      { requestId: "request-mismatch", deadlineMs: 10_000 },
    ),
    (error) => error?.status === 422 && error?.code === "request_fingerprint_mismatch",
  );
  assert.equal(fetchCount, 1);
});

test("네트워크 오류는 최대 3회 재시도한 뒤 NetworkError를 유지한다", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new TypeError("socket closed");
  };

  await assert.rejects(
    withImmediateTimers(() =>
      postIdempotent(
        "/v2/example",
        { scene: "offline" },
        { requestId: "request-network", deadlineMs: 10_000 },
      ),
    ),
    (error) => error instanceof NetworkError,
  );
  assert.equal(fetchCount, 4);
});

test("응답이 멈추면 deadline signal의 TimeoutError로 중단한다", async () => {
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
    });

  await assert.rejects(
    postIdempotent(
      "/v2/example",
      { scene: "hanging" },
      { requestId: "request-timeout", deadlineMs: 20 },
    ),
    (error) => error?.name === "TimeoutError",
  );
});

test("호출자 AbortSignal을 진행 중인 fetch까지 전달한다", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      );
    });

  const pending = postIdempotent(
    "/v2/example",
    { scene: "cancelled" },
    { requestId: "request-abort", signal: controller.signal, deadlineMs: 10_000 },
  );
  controller.abort(new DOMException("caller cancelled", "AbortError"));

  await assert.rejects(pending, (error) => error?.name === "AbortError");
});
