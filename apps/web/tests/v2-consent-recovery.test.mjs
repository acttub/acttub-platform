import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const appRoot = path.resolve(import.meta.dirname, "..");

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

test("TermsGate는 local pending이 없을 때 로그인 사용자의 pending을 서버에서 복구한다", () => {
  const source = readFileSync(
    path.join(appRoot, "src/features/practice/terms-gate.tsx"),
    "utf8",
  );

  assert.match(source, /getPendingConsents as getStoredPendingConsents/);
  assert.match(source, /getPendingConsents as fetchPendingConsents/);
  assert.match(source, /isLoggedIn\(\)/);
  assert.match(source, /serverPending\.documents\.length > 0/);
  assert.doesNotMatch(source, /searchParams\.get\(["']consent["']\)/);
});
