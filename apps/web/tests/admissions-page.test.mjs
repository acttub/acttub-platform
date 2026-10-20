// /admissions 입시 정보 목록. 프리렌더된 본문을 먼저 그리고, 서버 답이 오면 그 순간을 오늘로 삼아
// 다가오는 마감과 카드 배지를 세운다. 필터·검색·학년도 탭은 목록을 줄이거나 지난 입시결과로 바꾼다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.TZ = "Asia/Seoul";
process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { AdmissionsPage } = await import("../src/features/admissions/admissions-page.tsx");
const route = await import("../src/app/admissions/page.tsx");
const { normalizeAdmissions } = await import("../src/lib/api/v2/admissions.ts");

// 프리렌더 본문은 빌드 때 정적 자료를 normalizeAdmissions 로 채운 모양이다(admissions-static).
const payload = normalizeAdmissions({
  updated_at: "2026-08-30",
  disclaimer: "원서를 쓰기 전에 입학처 공고를 꼭 확인하세요.",
  universities: [
    {
      id: "seoul-arts",
      name: "서울예술대",
      region: "서울 종로",
      campus: "본교",
      type: "univ",
      admission_url: "https://example.ac.kr",
      resources: [{ id: "r1", title: "실기 영상", url: "https://youtu.be/x", source: "youtube" }],
    },
    {
      id: "gyeonggi-col",
      name: "경기전문대",
      region: "경기 용인",
      type: "college",
      admission_url: "https://example.ac.kr",
    },
  ],
  notices: [
    {
      id: "s1",
      university_id: "seoul-arts",
      admission_year: 2027,
      track: "수시",
      department: "연기과",
      discipline: "acting",
      csat_minimum: "없음",
      apply_start: "2026-09-05",
      apply_end: "2026-09-10",
      practical_items: [{ category: "free_acting" }],
      results: [
        {
          year: 2026,
          competition_rate: "30.5:1",
          quota: 20,
          applicants: 1610,
          transcript_avg: "3.2",
          transcript_cut70: "3.5",
        },
      ],
    },
    {
      id: "g1",
      university_id: "gyeonggi-col",
      admission_year: 2026,
      track: "정시",
      department: "뮤지컬과",
      discipline: "musical",
      csat_minimum: "국어 3등급",
      apply_start: "2026-07-20",
      apply_end: "2026-08-01",
      practical_items: [{ category: "dance" }],
      results: [],
    },
  ],
});

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let requests;

function serve(respond) {
  requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(String(url), "http://web.test").pathname);
    return respond();
  };
}

const okJson = (body) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  // 서버 답이 오는 순간을 한국 시각 2026-09-01 정오로 둔다.
  Date.now = () => Date.parse("2026-09-01T03:00:00Z");
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
});

const cards = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/admissions/"))
    .map((link) => link.getAttribute("href"));

async function renderAnswered() {
  serve(okJson(payload));
  render(react.createElement(AdmissionsPage, { initial: payload }));
  await waitFor(() => assert.equal(screen.getByText("다가오는 마감").textContent, "다가오는 마감"));
}

test("답이 오기 전에는 프리렌더 본문만 그리고, 오늘을 몰라 D-day 를 붙이지 않는다", () => {
  serve(() => new Promise(() => {}));
  render(react.createElement(AdmissionsPage, { initial: payload }));

  assert.deepEqual(requests, ["/v2/admissions"]);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "연기 입시 정보");
  assert.equal(
    screen.getByText(/원서를 쓰기 전에 입학처 공고를/).textContent,
    "ⓘ 원서를 쓰기 전에 입학처 공고를 꼭 확인하세요.",
  );
  assert.equal(screen.queryByText("다가오는 마감"), null);
  assert.equal(screen.getByText("대학 2곳").textContent, "대학 2곳");
  assert.deepEqual(cards(), ["/admissions/seoul-arts", "/admissions/gyeonggi-col"]);
});

test("답이 오면 다가오는 접수를 D-day 로 띄우고, 카드에 학과·요약·옮겨 온 요강을 적는다", async () => {
  await renderAnswered();

  const upcoming = screen.getByText("다가오는 마감").parentElement;
  assert.equal(within(upcoming).getByText("D-4").textContent, "D-4");
  assert.equal(within(upcoming).getByText("접수 시작").textContent, "접수 시작");
  assert.equal(within(upcoming).getByText("서울예술대").textContent, "서울예술대");

  const seoul = screen.getByRole("link", { name: /서울예술대/ });
  assert.equal(within(seoul).getByText("연기과 · 영상 1").textContent, "연기과 · 영상 1");
  assert.equal(within(seoul).getByText("본교").textContent, "본교");
  const gyeonggi = screen.getByRole("link", { name: /경기전문대/ });
  assert.equal(within(gyeonggi).getByText("정시 2026학년도 기준").textContent, "정시 2026학년도 기준");
  assert.deepEqual(
    screen.getAllByRole("tab").map((tab) => tab.textContent),
    ["2027학년도 모집", "2026학년도 결과"],
  );
});

test("검색어와 접수 가능만으로 대학을 줄이고, 맞는 대학이 없으면 그렇게 말한다", async () => {
  await renderAnswered();

  fireEvent.click(screen.getByRole("button", { name: "접수 가능만" }));
  assert.deepEqual(cards(), ["/admissions/seoul-arts"]);
  fireEvent.click(screen.getByRole("button", { name: "접수 가능만" }));

  fireEvent.change(screen.getByPlaceholderText("대학·학과·지역 검색"), {
    target: { value: "뮤지컬" },
  });
  assert.deepEqual(cards(), ["/admissions/gyeonggi-col"]);

  fireEvent.change(screen.getByPlaceholderText("대학·학과·지역 검색"), {
    target: { value: "없는대학" },
  });
  assert.equal(screen.getByText("조건에 맞는 대학이 없어요.").textContent, "조건에 맞는 대학이 없어요.");
  assert.equal(screen.getByText("대학 0곳").textContent, "대학 0곳");
});

test("필터를 열어 축을 고르면 개수가 버튼에 붙고, 초기화하면 검색어는 남긴 채 풀린다", async () => {
  await renderAnswered();

  fireEvent.click(screen.getByRole("button", { name: "필터" }));
  fireEvent.click(screen.getByRole("button", { name: "경기" }));
  assert.equal(screen.getByRole("button", { name: "경기" }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(cards(), ["/admissions/gyeonggi-col"]);
  assert.equal(screen.getByRole("button", { name: "필터 1" }).textContent, "필터 1");

  fireEvent.click(screen.getByRole("button", { name: "경기" }));
  fireEvent.click(screen.getByRole("button", { name: "수시" }));
  fireEvent.click(screen.getByRole("button", { name: "연기" }));
  fireEvent.click(screen.getByRole("button", { name: "자유연기" }));
  fireEvent.click(screen.getByRole("button", { name: "4년제" }));
  fireEvent.click(screen.getByRole("button", { name: "수능 최저 없음" }));
  assert.deepEqual(cards(), ["/admissions/seoul-arts"]);
  assert.equal(screen.getByRole("button", { name: "필터 5" }).textContent, "필터 5");

  fireEvent.change(screen.getByPlaceholderText("대학·학과·지역 검색"), {
    target: { value: "서울" },
  });
  fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
  assert.equal(screen.getByRole("button", { name: "필터" }).textContent, "필터");
  assert.equal(screen.getByPlaceholderText("대학·학과·지역 검색").value, "서울");
  assert.deepEqual(cards(), ["/admissions/seoul-arts"]);

  fireEvent.click(screen.getByRole("button", { name: "필터" }));
  assert.equal(screen.queryByRole("button", { name: "경기" }), null);
});

test("지난 학년도 탭은 경쟁률과 모집·지원·학생부 숫자를 한 줄에 보여 준다", async () => {
  await renderAnswered();

  fireEvent.click(screen.getByRole("tab", { name: "2026학년도 결과" }));

  assert.equal(screen.getByRole("tab", { name: "2026학년도 결과" }).getAttribute("aria-selected"), "true");
  const row = screen.getByRole("link", { name: /서울예술대/ });
  assert.equal(row.getAttribute("href"), "/admissions/seoul-arts");
  assert.equal(within(row).getByText("연기과 · 수시").textContent, "연기과 · 수시");
  assert.equal(
    within(row).getByText(/^모집/).textContent,
    "모집 20 · 지원 1,610 · 학생부 평균 3.2 · 70%컷 3.5",
  );
  assert.equal(within(row).getByText("30.5:1").textContent, "30.5:1");

  fireEvent.click(screen.getByRole("button", { name: "필터" }));
  fireEvent.click(screen.getByRole("button", { name: "경기" }));
  assert.equal(
    screen.getByText("조건에 맞는 2026학년도 입시결과가 없어요.").textContent,
    "조건에 맞는 2026학년도 입시결과가 없어요.",
  );

  fireEvent.click(screen.getByRole("tab", { name: "2027학년도 모집" }));
  assert.equal(screen.getByText("대학 1곳").textContent, "대학 1곳");
});

test("조회가 실패하면 프리렌더 본문을 그대로 두고 오류 한 줄을 띄운다", async () => {
  serve(() => new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }));
  render(react.createElement(AdmissionsPage, { initial: payload }));

  await waitFor(() =>
    assert.equal(
      screen.getByText("입시 정보를 불러오지 못했어요.").textContent,
      "입시 정보를 불러오지 못했어요.",
    ),
  );
  assert.deepEqual(cards(), ["/admissions/seoul-arts", "/admissions/gyeonggi-col"]);
  assert.equal(screen.queryByText("다가오는 마감"), null);
});

test("목록 페이지는 색인용 제목과 빵부스러기·운영사 구조화 데이터를 싣는다", () => {
  serve(() => new Promise(() => {}));
  const { container } = render(route.default());

  const types = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent)["@type"],
  );
  assert.deepEqual(types, ["BreadcrumbList", "Organization"]);
  assert.equal(route.metadata.alternates.canonical, "/admissions");
});
