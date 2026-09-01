import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, before, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount, react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const navigationMockUrl = `data:text/javascript,${encodeURIComponent(`
export const usePathname = () => globalThis.__authPathname;
export const useRouter = () => globalThis.__authRouter;
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") {
      return { url: navigationMockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { RequireAuthProbe } = await import(
  "./fixtures/require-auth-probe.tsx"
);
const { ConsentEntryBoundaryProbe } = await import(
  "./fixtures/consent-entry-boundary-probe.tsx"
);
const { clearConsentEntrySession } = await import(
  "../src/features/auth/consent-entry.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;
let probe;

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushEntryCheck() {
  await react.act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

before(() => {
  globalThis.__authPathname = "/home";
  globalThis.__authRouter = { replace: (path) => globalThis.__authRoutes.push(path) };
});

after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__authPathname;
  delete globalThis.__authRouter;
  delete globalThis.__authRoutes;
});

afterEach(() => {
  probe?.unmount();
  probe = undefined;
  window.history.replaceState(null, "", "/");
  globalThis.fetch = originalFetch;
  clearTokens();
  clearConsentEntrySession();
});

test("저장 세션은 서비스 화면을 열기 전에 서버 진입 판정을 읽는다", async () => {
  globalThis.__authRoutes = [];
  clearTokens();
  clearConsentEntrySession();
  setTokens({ access_token: "access-token", refresh_token: "refresh-token" });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({
      entry_status: "allowed",
      documents: [],
      undecided_documents: [],
    });
  };

  probe = mount(RequireAuthProbe);
  assert.equal(probe.latest.ready, false);
  await flushEntryCheck();

  assert.equal(probe.latest.ready, true);
  assert.deepEqual(requests, ["/v2/consents/entry"]);
  assert.deepEqual(globalThis.__authRoutes, []);
});

test("진입 조회 실패는 서비스 화면 대신 오류와 재시도를 남긴다", async () => {
  globalThis.__authRoutes = [];
  clearTokens();
  clearConsentEntrySession();
  setTokens({ access_token: "access-token", refresh_token: "retry-token" });
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

  probe = mount(RequireAuthProbe);
  await flushEntryCheck();

  assert.equal(probe.latest.ready, false);
  assert.equal(probe.latest.entryError, "네트워크 요청에 실패했습니다.");

  probe.act((value) => value.retryEntry());
  await flushEntryCheck();

  assert.equal(probe.latest.ready, true);
  assert.equal(probe.latest.entryError, null);
  assert.equal(requestCount, 2);
});

test("저장 세션의 미결정 판정은 query를 보존해 동의 화면으로 이동한다", async () => {
  globalThis.__authRoutes = [];
  window.history.replaceState(null, "", "/practice/history?session=session-1");
  clearTokens();
  clearConsentEntrySession();
  setTokens({ access_token: "access-token", refresh_token: "pending-token" });
  const undecided = {
    id: "privacy-v4",
    type: "privacy",
    version: "v4",
    title: "개인정보 처리방침",
    body: "본문",
    required: true,
    published_at: "2026-01-01T00:00:00Z",
    current_decision: null,
  };
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "decision_required",
      documents: [undecided],
      undecided_documents: [undecided],
    });

  probe = mount(RequireAuthProbe);
  await flushEntryCheck();

  assert.equal(probe.latest.ready, false);
  assert.deepEqual(globalThis.__authRoutes, [
    "/terms?next=%2Fpractice%2Fhistory%3Fsession%3Dsession-1",
  ]);
});

test("차단된 저장 세션은 직접 연 공개 서비스 화면의 내용도 보여 주지 않는다", async () => {
  globalThis.__authRoutes = [];
  globalThis.__authPathname = "/reading";
  window.history.replaceState(null, "", "/reading");
  clearTokens();
  clearConsentEntrySession();
  setTokens({ access_token: "access-token", refresh_token: "blocked-token" });
  globalThis.fetch = async () =>
    jsonResponse({
      entry_status: "blocked",
      documents: [
        {
          id: "required-v1",
          type: "terms",
          version: "v1",
          title: "이용약관",
          body: "본문",
          required: true,
          published_at: "2026-01-01T00:00:00Z",
          current_decision: "revoked",
        },
      ],
      undecided_documents: [],
    });

  probe = mount(ConsentEntryBoundaryProbe);
  await flushEntryCheck();

  assert.equal(probe.text().includes("service-content"), false);
  assert.deepEqual(globalThis.__authRoutes, ["/terms"]);
});

test("허용된 저장 세션은 직접 연 공개 서비스 화면을 서버 확인 뒤 보여 준다", async () => {
  globalThis.__authRoutes = [];
  globalThis.__authPathname = "/reading";
  window.history.replaceState(null, "", "/reading");
  clearTokens();
  clearConsentEntrySession();
  setTokens({ access_token: "access-token", refresh_token: "allowed-token" });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({
      entry_status: "allowed",
      documents: [],
      undecided_documents: [],
    });
  };

  probe = mount(ConsentEntryBoundaryProbe);
  assert.equal(probe.text().includes("service-content"), false);
  await flushEntryCheck();

  assert.equal(probe.text().includes("service-content"), true);
  assert.deepEqual(requests, ["/v2/consents/entry"]);
  assert.deepEqual(globalThis.__authRoutes, []);
});
