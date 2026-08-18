import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { getPendingConsents } = await import(
  "../src/lib/api/v2/consents.ts"
);
const { onSessionEvent } = await import("../src/lib/auth/session-events.ts");
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearTokens();
  setTokens({ access_token: "access-token", refresh_token: "refresh-token" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("403 consent_required는 기존 ApiError를 유지하면서 세션 이벤트를 보낸다", async () => {
  let fetchCount = 0;
  let eventCount = 0;
  const unsubscribe = onSessionEvent((event) => {
    if (event === "consent-required") eventCount += 1;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ detail: "consent_required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      apiFetch("/v2/uploads/intents"),
      (error) => error?.status === 403 && error?.code === "consent_required",
    );
    assert.equal(fetchCount, 1);
    assert.equal(eventCount, 1);
  } finally {
    unsubscribe();
  }
});

test("getPendingConsents는 인증된 사용자 pending endpoint를 조회한다", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ documents: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  assert.deepEqual(await getPendingConsents(), { documents: [] });
  assert.equal(request.url, "/v2/consents/pending");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.get("Authorization"), "Bearer access-token");
});

// 여기 있던 소스 정규식 순찰("TermsGate는 local pending이 없을 때 …")은 걷었다. 그것이
// 고정한 넷 — 기기에 남은 것을 먼저 읽는다 · 로그인일 때만 서버에 묻는다 · 서버가 준 것이
// 있으면 거기서 멈춘다 — 은 이제 tests/consent-documents.test.mjs 가 실제로 돌려 본다.
// 다섯째("?consent= 쿼리로 모드를 정하지 않는다")는 그 파이프라인이 signal 하나만 받는
// 함수가 되어 URL 에 닿을 길이 없다 — 구조가 대신한다.
//
// 옛 순찰이 배선(화면이 그 파이프라인을 실제로 부르는가)까지 잡았던 것은 아니다. 정규식이
// import 문의 존재만 보므로 import 를 남기고 호출을 지워도 초록이었다.
