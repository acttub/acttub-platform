import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { canSubmitConsentDecisions, submitConsentDecisions } = await import(
  "../src/features/practice/consent-entry-submission.ts"
);
const { clearConsentEntrySession } = await import(
  "../src/features/auth/consent-entry.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

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
  setTokens({ access_token: "access-token", refresh_token: "refresh-token" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  clearConsentEntrySession();
});

test("필수는 수락하고 선택은 수락·거절 중 하나를 명시해야 제출할 수 있다", () => {
  const documents = [
    document("required"),
    document("optional", { required: false, type: "ai_analysis" }),
  ];

  assert.equal(canSubmitConsentDecisions(documents, new Map()), false);
  assert.equal(
    canSubmitConsentDecisions(
      documents,
      new Map([
        ["required", "declined"],
        ["optional", "granted"],
      ]),
    ),
    false,
  );
  assert.equal(
    canSubmitConsentDecisions(
      documents,
      new Map([
        ["required", "granted"],
        ["optional", "declined"],
      ]),
    ),
    true,
  );
});

test("여러 결정 중 성공한 문서는 보존하고 실패한 문서만 돌려준다", async () => {
  const documents = [
    document("required"),
    document("optional", { required: false, type: "ai_analysis" }),
  ];
  const choices = new Map([
    ["required", "granted"],
    ["optional", "declined"],
  ]);
  const requestedIds = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "/v2/consents");
    const body = JSON.parse(options.body);
    requestedIds.push(body.document_id);
    return body.document_id === "required"
      ? jsonResponse({ id: "event-1" })
      : jsonResponse({ detail: "temporary_failure" }, 500);
  };

  const result = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(),
  });

  assert.equal(result.kind, "partial");
  assert.deepEqual(result.completedDocumentIds, ["required"]);
  assert.deepEqual(
    result.failedDocuments.map((item) => item.id),
    ["optional"],
  );
  assert.deepEqual(requestedIds, ["required", "optional"]);
});

test("부분 실패 재시도는 실패 문서만 저장한 뒤 서버의 최종 허용을 다시 확인한다", async () => {
  const documents = [
    document("required"),
    document("optional", { required: false, type: "ai_analysis" }),
  ];
  const choices = new Map([
    ["required", "granted"],
    ["optional", "declined"],
  ]);
  const requests = [];
  let optionalAttempts = 0;
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/v2/consents") {
      const body = JSON.parse(options.body);
      requests.push(`POST:${body.document_id}`);
      if (body.document_id === "optional") {
        optionalAttempts += 1;
        if (optionalAttempts === 1) {
          return jsonResponse({ detail: "temporary_failure" }, 500);
        }
      }
      return jsonResponse({ id: `event-${body.document_id}` });
    }
    if (path === "/v2/consents/entry") {
      requests.push("GET:entry");
      return jsonResponse({
        entry_status: "allowed",
        documents: [],
        undecided_documents: [],
      });
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  const partial = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(),
  });
  assert.equal(partial.kind, "partial");

  const retried = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(partial.completedDocumentIds),
  });

  assert.equal(retried.kind, "verified");
  assert.equal(retried.entry.entry_status, "allowed");
  assert.deepEqual(retried.completedDocumentIds, ["required", "optional"]);
  assert.deepEqual(requests, [
    "POST:required",
    "POST:optional",
    "POST:optional",
    "GET:entry",
  ]);
});

test("최종 재확인 실패는 저장을 반복하지 않고 조회만 다시 시도한다", async () => {
  const documents = [document("required")];
  const choices = new Map([["required", "granted"]]);
  const requests = [];
  let verificationAttempts = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path === "/v2/consents") {
      requests.push("POST:required");
      return jsonResponse({ id: "event-required" });
    }
    if (path === "/v2/consents/entry") {
      requests.push("GET:entry");
      verificationAttempts += 1;
      if (verificationAttempts === 1) throw new TypeError("offline");
      return jsonResponse({
        entry_status: "allowed",
        documents: [],
        undecided_documents: [],
      });
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  const failedVerification = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(),
  });

  assert.equal(failedVerification.kind, "verification_failed");
  assert.deepEqual(failedVerification.completedDocumentIds, ["required"]);

  const retried = await submitConsentDecisions({
    documents,
    choices,
    completedDocumentIds: new Set(failedVerification.completedDocumentIds),
  });

  assert.equal(retried.kind, "verified");
  assert.deepEqual(requests, ["POST:required", "GET:entry", "GET:entry"]);
});

test("제출 사이 문서가 바뀌면 로그아웃하지 않고 최신 진입 판정으로 교체한다", async () => {
  const oldDocument = document("old-required");
  const newDocument = document("new-required");
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requests.push(path);
    if (path === "/v2/consents") {
      return jsonResponse({ detail: "consent_document_not_found" }, 404);
    }
    if (path === "/v2/consents/entry") {
      return jsonResponse({
        entry_status: "decision_required",
        documents: [newDocument],
        undecided_documents: [newDocument],
      });
    }
    throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
  };

  const result = await submitConsentDecisions({
    documents: [oldDocument],
    choices: new Map([[oldDocument.id, "granted"]]),
    completedDocumentIds: new Set(),
  });

  assert.equal(result.kind, "verified");
  assert.equal(result.entry.entry_status, "decision_required");
  assert.deepEqual(result.entry.undecided_documents, [newDocument]);
  assert.deepEqual(requests, ["/v2/consents", "/v2/consents/entry"]);
});
