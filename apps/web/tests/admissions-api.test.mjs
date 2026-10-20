// 입시 정보 서버 조회(GET /v2/admissions, GET /v2/admissions/{university_id}). 공개 정보라 토큰을 붙이지 않고,
// 응답에서 빠진 리스트 필드는 들어오는 자리에서 빈 배열로 메운다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { getAdmissions, getUniversityAdmissions, groupTips, cardBadge, summaryLine, normalizeAdmissions } =
  await import("../src/lib/api/v2/admissions.ts");
const { setTokens, clearTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

function recordFetch(payload) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    requests.push({
      url: String(url),
      method: init.method,
      authorization: headers.get("Authorization"),
      client: headers.get("X-Acttub-Client"),
    });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return requests;
}

const SPARSE = {
  updated_at: "2026-08-04",
  disclaimer: "최종 확인은 각 대학 입학처 공고로 해주세요.",
  universities: [{ id: "cau", name: "중앙대학교", admission_url: "https://admission.cau.ac.kr" }],
  notices: [{ id: "n-1", university_id: "cau", track: "수시" }],
};

const FILLED = {
  ...SPARSE,
  universities: [{ ...SPARSE.universities[0], resources: [], tips: [] }],
  notices: [
    {
      ...SPARSE.notices[0],
      designated_works: [],
      essay_questions: [],
      stages: [],
      practical_items: [],
      results: [],
    },
  ],
};

test("입시 목록은 로그인 없이 GET /v2/admissions 로 받고 빠진 리스트를 빈 배열로 채운다", async () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  const requests = recordFetch(SPARSE);

  const result = await getAdmissions();

  assert.deepEqual(result, FILLED);
  assert.deepEqual(requests, [
    { url: "/v2/admissions", method: "GET", authorization: null, client: "web/0.1.0" },
  ]);
});

test("대학 하나는 id 를 경로에 인코딩해 GET /v2/admissions/{id} 로 받는다", async () => {
  const requests = recordFetch(SPARSE);

  const result = await getUniversityAdmissions("서울 예대/1");

  assert.deepEqual(result, FILLED);
  assert.deepEqual(requests, [
    {
      url: "/v2/admissions/%EC%84%9C%EC%9A%B8%20%EC%98%88%EB%8C%80%2F1",
      method: "GET",
      authorization: null,
      client: "web/0.1.0",
    },
  ]);
});

test("응답에 대학·공고 배열 자체가 없어도 빈 목록이 된다", () => {
  const filled = normalizeAdmissions({ updated_at: "2026-08-04", disclaimer: "d" });
  assert.deepEqual(filled, { updated_at: "2026-08-04", disclaimer: "d", universities: [], notices: [] });
});

test("꿀팁이 아예 없으면 묶음도 없고, 겹친 횟수를 모르는 팁은 한 번으로 센다", () => {
  assert.deepEqual(groupTips(undefined), []);
  const groups = groupTips([
    { text: "모름", category: "place", source_type: "personal" },
    { text: "둘", category: "place", source_type: "personal", corroborations: 2 },
    { text: "또 모름", category: "place", source_type: "personal" },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((t) => t.text)]),
    [["고사장·이동", ["둘", "모름", "또 모름"]]],
  );
});

test("오늘이 접수 마감일이면 배지는 D-DAY 다", () => {
  const notices = [{ id: "a", university_id: "u", apply_start: "2026-09-08", apply_end: "2026-09-11" }];
  assert.deepEqual(cardBadge(notices, "2026-09-11"), { label: "D-DAY", tone: "live" });
});

test("요약 줄은 실기 항목이 없는 공고를 건너뛰고 모르는 종목은 받은 이름 그대로 쓴다", () => {
  const line = summaryLine([
    { id: "a", university_id: "u", track: " 정시 ", apply_end: "2026-12-30" },
    { id: "b", university_id: "u", track: null, practical_items: [{ category: "mime" }, { category: "song" }] },
  ]);
  assert.equal(line, "정시 · mime·노래 · 접수 12월");
});
