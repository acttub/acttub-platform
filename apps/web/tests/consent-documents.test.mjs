// 약관 화면이 어느 문서를 보여 줄지 정하는 세 단계. 컴포넌트 안 이펙트에 있는 동안에는
// 순서를 확인할 표면이 없었다(마크업 단언까지는 가지 않으므로).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
// 첫 단계가 기기에 남은 것을 읽으므로 localStorage 가 필요하다.
import "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { loadConsentDocuments } = await import(
  "../src/features/practice/consent-documents.ts"
);
const { clearPendingConsents, getPendingConsents, savePendingConsents } =
  await import("../src/features/auth/pending-consents.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const PENDING = "/v2/consents/pending";
const ALL = "/v2/consents/documents";

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
    ...overrides,
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** 어느 경로를 실제로 물었는지 순서대로 모은다. 목이 없는 경로를 물으면 그 자리에서 깨진다. */
function stubFetch(routes) {
  const asked = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    asked.push({ path, signal: options?.signal });
    const handler = routes[path];
    if (!handler) throw new Error(`묻지 않아야 하는 곳을 물었다: ${path}`);
    return handler();
  };
  return asked;
}

beforeEach(() => {
  clearTokens();
  clearPendingConsents();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  clearPendingConsents();
});

test("기기에 남은 것이 있으면 서버를 아예 묻지 않는다", async () => {
  savePendingConsents([document("stored-1")]);
  setTokens({ access_token: "a", refresh_token: "r" });
  const asked = stubFetch({});

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "pending");
  assert.deepEqual(
    result.documents.map((d) => d.id),
    ["stored-1"],
  );
  assert.deepEqual(asked, []);
});

test("로그인하지 않았으면 남은 동의를 묻지 않고 전체 목록만 읽는다", async () => {
  const asked = stubFetch({
    [ALL]: () => jsonResponse({ documents: [document("all-1")] }),
  });

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "info");
  assert.deepEqual(
    result.documents.map((d) => d.id),
    ["all-1"],
  );
  // /pending 은 로그인 전용이다. 물으면 401 을 맞고 화면이 오류로 간다.
  assert.deepEqual(
    asked.map((a) => a.path),
    [ALL],
  );
});

test("서버가 남은 동의를 주면 pending 이고 기기에도 심는다", async () => {
  setTokens({ access_token: "a", refresh_token: "r" });
  const asked = stubFetch({
    [PENDING]: () => jsonResponse({ documents: [document("pending-1")] }),
  });

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "pending");
  // 다음 진입이 서버를 다시 묻지 않게 심는다 — 첫 단계가 그것을 읽는다.
  assert.deepEqual(
    getPendingConsents().map((d) => d.id),
    ["pending-1"],
  );
  assert.deepEqual(
    asked.map((a) => a.path),
    [PENDING],
  );
});

test("서버가 남은 동의가 없다고 하면 전체 목록으로 넘어간다", async () => {
  setTokens({ access_token: "a", refresh_token: "r" });
  const asked = stubFetch({
    [PENDING]: () => jsonResponse({ documents: [] }),
    [ALL]: () => jsonResponse({ documents: [document("all-1")] }),
  });

  const result = await loadConsentDocuments();

  assert.equal(result.mode, "info");
  assert.deepEqual(
    asked.map((a) => a.path),
    [PENDING, ALL],
  );
  // 남은 것이 없으니 기기에 심을 것도 없다.
  assert.deepEqual(getPendingConsents(), []);
});

test("취소 신호가 두 조회에 그대로 실린다", async () => {
  setTokens({ access_token: "a", refresh_token: "r" });
  const controller = new AbortController();
  const asked = stubFetch({
    [PENDING]: () => jsonResponse({ documents: [] }),
    [ALL]: () => jsonResponse({ documents: [] }),
  });

  await loadConsentDocuments(controller.signal);

  // 옛 코드는 signal 을 넘길 수 없어(consents.ts 가 받지 않았다) 화면을 떠나도 요청이
  // 계속 날아갔고, 돌아온 답만 버렸다.
  assert.equal(asked.length, 2);
  for (const { path, signal } of asked) {
    assert.equal(signal, controller.signal, `${path} 에 신호가 실리지 않았다`);
  }
});
