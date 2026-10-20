// app.audition — 오디션 공고 서버 조회. 공개 정보라 게스트 토큰을 붙이지 않고, 기능이 꺼진 서버의 빈 응답도
// 빈 목록으로 받는다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { getAuditions } = await import("../src/lib/api/v2/auditions.ts");
const { setTokens, clearTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

function recordFetch(body) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method, authorization: new Headers(init.headers).get("Authorization") });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return requests;
}

const POSTING = {
  id: "posting-1",
  title: "단편영화 〈여름〉 주연 모집",
  category: "film",
  source: "filmmakers",
  source_name: "필름메이커스",
  pay_text: "회차당 10만 원",
  apply_start: "2026-10-15",
  apply_end: "2026-10-31",
  status_text: null,
  posted_on: "2026-10-15",
  source_url: "https://filmmakers.example/posting/1",
};

test("app.audition: 공고는 로그인 없이 GET /v2/auditions 로 받아 그대로 돌려준다", async () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  const requests = recordFetch(JSON.stringify({ items: [POSTING], collected_at: "2026-10-20T00:00:00Z" }));

  const result = await getAuditions();

  assert.deepEqual(result, { items: [POSTING], collected_at: "2026-10-20T00:00:00Z" });
  assert.deepEqual(requests, [{ url: "/v2/auditions", method: "GET", authorization: null }]);
});

test("app.audition: 본문이 빈 응답도 빈 목록과 모은 적 없음으로 받는다", async () => {
  recordFetch("{}");

  assert.deepEqual(await getAuditions(), { items: [], collected_at: null });
});
