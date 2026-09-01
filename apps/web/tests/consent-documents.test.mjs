import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { loadConsentDocuments } = await import(
  "../src/features/practice/consent-documents.ts"
);
const { clearConsentEntrySession } = await import(
  "../src/features/auth/consent-entry.ts"
);
const { clearPendingConsents, savePendingConsents } = await import(
  "../src/features/auth/pending-consents.ts"
);
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function document(id, overrides = {}) {
  return {
    id,
    type: "terms",
    version: "v1",
    title: `문서 ${id}`,
    body: "본문",
    required: true,
    published_at: "2026-01-01T00:00:00Z",
    current_decision: null,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearTokens();
  clearConsentEntrySession();
  clearPendingConsents();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  clearConsentEntrySession();
  clearPendingConsents();
});

test("로그인하지 않은 약관 방문은 공개 문서 목록만 읽는다", async () => {
  const controller = new AbortController();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ path: String(url), signal: options.signal });
    return jsonResponse({ documents: [document("public")] });
  };

  const result = await loadConsentDocuments(controller.signal);

  assert.equal(result.mode, "info");
  assert.deepEqual(result.documents.map((item) => item.id), ["public"]);
  assert.deepEqual(requests, [
    { path: "/v2/consents/documents", signal: controller.signal },
  ]);
});

test("로그인한 약관 방문은 오래된 기기 캐시보다 서버 진입 판정을 우선한다", async () => {
  setTokens({ access_token: "access", refresh_token: "refresh" });
  const stale = { ...document("stale") };
  delete stale.current_decision;
  savePendingConsents([stale]);
  const current = document("current", { required: false, type: "ai_analysis" });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({
      entry_status: "decision_required",
      documents: [current],
      undecided_documents: [current],
    });
  };

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "decision_required");
  assert.deepEqual(result.documents.map((item) => item.id), ["current"]);
  assert.deepEqual(requests, ["/v2/consents/entry"]);
});

test("차단 판정은 미결정 목록이 아니라 현재 문서 전체를 관리 표면에 준다", async () => {
  setTokens({ access_token: "access", refresh_token: "blocked-refresh" });
  const blocked = document("required-revoked", { current_decision: "revoked" });
  const undecided = document("optional-undecided", {
    required: false,
    type: "ai_analysis",
  });
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "blocked",
      documents: [blocked, undecided],
      undecided_documents: [undecided],
    });

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "blocked");
  assert.deepEqual(result.documents.map((item) => item.id), [
    "required-revoked",
    "optional-undecided",
  ]);
});

test("동의 화면과 진입 게이트는 같은 세션 판정을 공유한다", async () => {
  setTokens({ access_token: "access", refresh_token: "shared-refresh" });
  const undecided = document("shared");
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return jsonResponse({
      entry_status: "decision_required",
      documents: [undecided],
      undecided_documents: [undecided],
    });
  };

  const first = await loadConsentDocuments();
  const second = await loadConsentDocuments();

  assert.equal(first.mode, "decision_required");
  assert.equal(second.mode, "decision_required");
  assert.equal(requestCount, 1);
});
