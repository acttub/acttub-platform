import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const {
  clearConsentEntrySession,
  readConsentEntryOnce,
  resolveConsentEntry,
} = await import("../src/features/auth/consent-entry.ts");
const {
  clearPendingConsents,
  getPendingConsents,
  hasAcceptedCurrentPrivacy,
  markPrivacyVersionAccepted,
  savePendingConsents,
} = await import("../src/features/auth/pending-consents.ts");
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);
const { login } = await import("../src/lib/api/v2/auth.ts");

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
  savePendingConsents([]);
  clearPendingConsents();
  setTokens({ access_token: "access-token", refresh_token: "refresh-token" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  clearConsentEntrySession();
  savePendingConsents([]);
  clearPendingConsents();
});

test("같은 인증 세션의 진입 판정은 서버에서 한 번만 읽는다", async () => {
  const undecided = document("terms-v1");
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return jsonResponse({
      entry_status: "decision_required",
      documents: [undecided],
      undecided_documents: [undecided],
    });
  };

  const [first, second] = await Promise.all([
    readConsentEntryOnce(),
    readConsentEntryOnce(),
  ]);

  assert.equal(first.entry_status, "decision_required");
  assert.equal(second, first);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/v2/consents/entry");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(
    requests[0].options.headers.get("Authorization"),
    "Bearer access-token",
  );
});

test("저장 세션에서 새 계약이 404면 기존 미결정 문서 조회로 안전하게 폴백한다", async () => {
  const pending = document("legacy-pending");
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requests.push(path);
    if (path === "/v2/consents/entry") {
      return jsonResponse({ detail: "not_found" }, 404);
    }
    if (path === "/v2/consents/pending") {
      const legacyDocument = { ...pending };
      delete legacyDocument.current_decision;
      return jsonResponse({ documents: [legacyDocument] });
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  const result = await readConsentEntryOnce();

  assert.equal(result.entry_status, "decision_required");
  assert.deepEqual(result.documents, [pending]);
  assert.deepEqual(result.undecided_documents, [pending]);
  assert.deepEqual(requests, [
    "/v2/consents/entry",
    "/v2/consents/pending",
  ]);
});

test("새 로그인은 계약이 404여도 로그인 응답을 쓰고 미결정 문서를 다시 묻지 않는다", async () => {
  clearTokens();
  clearConsentEntrySession();
  const pending = document("login-pending");
  const loginDocument = { ...pending };
  delete loginDocument.current_decision;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    requests.push(path);
    if (path === "/v2/auth/login") {
      assert.equal(options.method, "POST");
      return jsonResponse({
        access_token: "login-access",
        refresh_token: "login-refresh",
        token_type: "bearer",
        expires_in: 900,
        user: { id: "actor-1", email: null, status: "active" },
        pending_consents: [loginDocument],
      });
    }
    if (path === "/v2/consents/entry") {
      assert.equal(options.headers.get("Authorization"), "Bearer login-access");
      return jsonResponse({ detail: "not_found" }, 404);
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  const loginResult = await login("development", "actor-1");
  const resolution = await resolveConsentEntry("/home", {
    fallbackDocuments: loginResult.pending_consents,
  });

  assert.equal(resolution.kind, "decision_required");
  assert.deepEqual(resolution.entry.undecided_documents, [pending]);
  assert.deepEqual(requests, ["/v2/auth/login", "/v2/consents/entry"]);
});

test("진입 조회 실패는 캐시하지 않아 같은 화면에서 다시 시도할 수 있다", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) throw new TypeError("offline");
    return jsonResponse({
      entry_status: "allowed",
      documents: [],
      undecided_documents: [],
    });
  };

  await assert.rejects(readConsentEntryOnce(), /네트워크 요청에 실패했습니다/);
  const retried = await readConsentEntryOnce();

  assert.equal(retried.entry_status, "allowed");
  assert.equal(requestCount, 2);
});

test("미결정 판정은 현재 목적지를 보존한 동의 화면으로 보낸다", async () => {
  const undecided = document("privacy-v4", {
    type: "privacy",
    version: "v4",
  });
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "decision_required",
      documents: [undecided],
      undecided_documents: [undecided],
    });

  const result = await resolveConsentEntry(
    "/practice/history?session=session-1",
  );

  assert.equal(result.kind, "decision_required");
  assert.equal(
    result.destination,
    "/terms?next=%2Fpractice%2Fhistory%3Fsession%3Dsession-1",
  );
  assert.deepEqual(getPendingConsents(), [
    {
      id: undecided.id,
      type: undecided.type,
      version: undecided.version,
      title: undecided.title,
      body: undecided.body,
      required: undecided.required,
      published_at: undecided.published_at,
    },
  ]);
});

test("차단은 서비스 복귀 경로 없이 약관 관리로 보내고 허용은 바로 진입시킨다", async () => {
  const blockedDocument = document("required-v1", {
    current_decision: "revoked",
  });
  savePendingConsents([
    {
      id: "stale",
      type: "terms",
      version: "old",
      title: "오래된 문서",
      body: "본문",
      required: true,
      published_at: "2025-01-01T00:00:00Z",
    },
  ]);
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "blocked",
      documents: [blockedDocument],
      undecided_documents: [],
    });

  const blocked = await resolveConsentEntry("/home");

  assert.equal(blocked.kind, "blocked");
  assert.equal(blocked.destination, "/terms");
  assert.deepEqual(getPendingConsents(), []);

  clearConsentEntrySession();
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "allowed",
      documents: [],
      undecided_documents: [],
    });

  const allowed = await resolveConsentEntry("/home");

  assert.equal(allowed.kind, "allowed");
  assert.equal("destination" in allowed, false);
});

test("현재 개인정보 결정이 철회된 차단 판정은 기기의 옛 계측 동의를 지운다", async () => {
  markPrivacyVersionAccepted("v4");
  assert.equal(hasAcceptedCurrentPrivacy(), true);
  const privacy = document("privacy-v4", {
    type: "privacy",
    version: "v4",
    current_decision: "revoked",
  });
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "blocked",
      documents: [privacy],
      undecided_documents: [],
    });

  await resolveConsentEntry("/home");

  assert.equal(hasAcceptedCurrentPrivacy(), false);
});
