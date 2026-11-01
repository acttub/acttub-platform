// /admissions/<대학 id> 상세. 올해 요강은 진행 상태·D-day 와 함께, 올해 요강이 없는 전형은 지난 학년도
// 요강을 옮겼다고 밝히며 날짜로 상태를 말하지 않는다. 지난 입시결과·후기·참고 영상·가이드 링크를 덧붙인다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.TZ = "Asia/Seoul";
process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react");
const { UniversityDetailPage } = await import("../src/features/admissions/university-detail.tsx");
const { normalizeAdmissions } = await import("../src/lib/api/v2/admissions.ts");

const university = {
  id: "seoul-arts",
  name: "서울예술대",
  campus: "안산",
  type: "college",
  region: "경기 안산",
  admission_url: "https://admission.example.ac.kr",
  note: null,
  tips: [
    {
      year: 2026,
      category: "day_of",
      text: "대기실에서 두 시간 기다렸어요.",
      corroborations: 3,
      source_type: "official",
      host: "cafe.example.com",
      source_url: "https://cafe.example.com/1",
      note: "2026학년도 수시 기준",
    },
    { year: null, category: "unknown_kind", text: "물을 챙기세요.", source_type: "academy" },
  ],
  resources: [
    {
      title: "2026 실기 시범",
      url: "https://youtu.be/a",
      source_type: "official",
      publisher: "서울예술대 입학처",
      note: "학교가 올린 영상",
    },
    { title: "합격 후기 영상", url: "https://youtu.be/b", source_type: "academy", publisher: "OO연기학원" },
  ],
};

const current = {
  id: "n2027",
  university_id: "seoul-arts",
  admission_year: 2027,
  track: "수시",
  discipline: "acting",
  department: "연기전공",
  screening: "실기우수자",
  apply_start: "2026-09-05",
  apply_end: "2026-09-10",
  practical_date: "2026-10-01",
  practical_date_end: "2026-10-03",
  announce_date: "2026-11-01",
  quota: "20명",
  fee: "80,000원",
  weights: { practical: 70, transcript: 30, csat: 0 },
  weights_note: "1단계는 실기만 봐요.",
  stages: [
    { order: 2, name: "최종", weight: 0, evaluates: [] },
    {
      order: 1,
      name: "실기",
      multiple: "10배수",
      weight: 100,
      date: "10월 1일",
      evaluates: ["free_acting", "song"],
      note: "기초 실기",
    },
  ],
  practical_items: [
    {
      category: "free_acting",
      label: "독백",
      required: true,
      count: 1,
      time_limit_sec: 90,
      weight: 60,
      stage: 1,
      note: "현대극만",
    },
    { category: "song", required: false, time_limit_sec: 120 },
    { category: "mime", time_limit_sec: 30 },
  ],
  practical_task: "자유연기 1분 30초",
  dress_code: "편한 옷",
  preparation: "신분증",
  documents: "없음",
  csat_minimum: "없음",
  designated_works: ["햄릿"],
  essay_questions: ["지원 동기"],
  note: "요강은 바뀔 수 있어요.",
  source_url: "https://admission.example.ac.kr/2027",
  results: [
    { year: 2024 },
    { year: 2025, waitlist_last: 0 },
    {
      year: 2026,
      competition_rate: "30.5:1",
      quota: 20,
      applicants: 1610,
      transcript_avg: "3.2",
      transcript_cut50: "3.0",
      transcript_cut70: "3.5",
      transcript_low: "4.1",
      fill_rate: "50%",
      waitlist_last: 3,
      waitlist_count: 5,
      practical_avg: "85",
      practical_cut50: "84",
      practical_cut70: "80",
      note: "입학처 공개 자료",
      source_url: "https://admission.example.ac.kr/result",
    },
  ],
};

const standIn = {
  id: "n2026",
  university_id: "seoul-arts",
  admission_year: 2026,
  track: "정시",
  screening: "정시 실기",
  department: null,
  apply_end: "2025-12-31",
  weights_note: "실기 100%",
  results: [{ year: 2026, competition_rate: "12:1" }],
};

const undated = {
  id: "nx",
  university_id: "seoul-arts",
  department: "뮤지컬전공",
  apply_end: "2026-08-01",
};

const payload = normalizeAdmissions({
  updated_at: "2026-08-30",
  disclaimer: "원서 전에 입학처 공고를 확인하세요.",
  universities: [university],
  notices: [standIn, current, undated],
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
const json = (body, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  Date.now = () => Date.parse("2026-09-01T03:00:00Z");
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
});

function renderDetail(initial = payload, latestYear = 2027) {
  render(
    react.createElement(UniversityDetailPage, { universityId: "seoul-arts", initial, latestYear }),
  );
}

const section = (heading) => screen.getByRole("heading", { name: heading }).closest("section");

test("대학 머리와 한눈에 보기는 응답 전에도 프리렌더 본문으로 그린다", () => {
  serve(() => new Promise(() => {}));
  renderDetail();

  assert.deepEqual(requests, ["/v2/admissions/seoul-arts"]);
  assert.equal(screen.getByRole("link", { name: "← 입시 정보" }).getAttribute("href"), "/admissions");
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "서울예술대");
  assert.equal(screen.getByText("안산").textContent, "안산");
  assert.equal(screen.getByText("전문대").textContent, "전문대");
  assert.equal(
    within(screen.getAllByRole("banner").at(-1)).getByRole("link", { name: "입학처 원문 ↗" }).getAttribute("href"),
    "https://admission.example.ac.kr",
  );
  assert.deepEqual(
    within(section("한눈에 보기"))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
    [
      "· 2027학년도에는 수시 1개 전형으로 뽑아요.",
      "· 정시는 2027학년도 요강이 아직 나오지 않아 2026학년도 기준으로 적었어요.",
      "· 실기는 자유연기·노래·mime를 봐요.",
      // 경쟁률 문장은 공고가 온 순서를 따른다.
      "· 2026학년도 정시 경쟁률은 12:1이었어요.",
      "· 2026학년도 연기전공 수시 경쟁률은 30.5:1이었어요.",
      "· 먼저 응시한 사람들의 후기 2건을 학년도별로 묶었어요.",
    ],
  );
  // 오늘을 모르니 진행 상태나 D-day 를 말하지 않는다.
  assert.equal(screen.queryByText(/D-\d/), null);
  assert.equal(screen.queryByText("접수 마감"), null);
});

test("답이 오면 올해 전형에 D-day 를, 날짜만 아는 전형에 진행 상태를 붙이고 옮긴 요강엔 붙이지 않는다", async () => {
  serve(json(payload));
  renderDetail();

  await waitFor(() => assert.equal(screen.getByText("접수 시작 D-4").textContent, "접수 시작 D-4"));
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).slice(1, 4),
    ["2027학년도 모집요강", "2026학년도 모집요강", "학년도 미확인 공고"],
  );
  const standInSection = section("2026학년도 모집요강");
  assert.equal(
    within(standInSection).getByText(/요강이 아직 나오지 않아/).textContent,
    "2027학년도 요강이 아직 나오지 않아 2026학년도 요강을 옮겨 뒀어요. 일정과 실기 과제는 올해 바뀔 수 있으니 참고로만 봐 주세요.",
  );
  assert.equal(within(standInSection).getByText("2026학년도 기준").textContent, "2026학년도 기준");
  assert.equal(within(standInSection).getByText("학과 미확인").textContent, "학과 미확인");
  assert.equal(within(standInSection).queryByText("접수 마감"), null);
  assert.equal(within(standInSection).getByText("실기 100%").textContent, "실기 100%");

  assert.equal(within(section("학년도 미확인 공고")).getByText("접수 마감").textContent, "접수 마감");
});

test("올해 전형 카드는 일정·반영비율·단계·실기 종목·원문 블록을 모두 편다", () => {
  serve(() => new Promise(() => {}));
  renderDetail();
  const card = screen.getByRole("heading", { name: "연기전공" }).closest("section");
  const text = (value) => within(card).getByText(value).textContent;

  assert.equal(text("2026-09-05 ~ 2026-09-10"), "2026-09-05 ~ 2026-09-10");
  assert.equal(text("2026-10-01 ~ 2026-10-03"), "2026-10-01 ~ 2026-10-03");
  assert.equal(text("2026-11-01"), "2026-11-01");
  assert.equal(text("20명"), "20명");
  assert.equal(text("80,000원"), "80,000원");
  assert.equal(text("실기우수자"), "실기우수자");
  assert.equal(text("실기 70%"), "실기 70%");
  assert.equal(text("학생부 30%"), "학생부 30%");
  assert.equal(within(card).queryByText("수능 0%"), null);
  assert.equal(text("1단계는 실기만 봐요."), "1단계는 실기만 봐요.");

  const stages = within(card).getByText("단계별 전형").nextElementSibling;
  assert.deepEqual(
    [...stages.children].map((item) => item.textContent),
    ["1단계실기10배수반영 100%10월 1일 · 자유연기, 노래기초 실기", "2단계최종성적 미반영"],
  );

  const items = within(card).getByText("실기 종목").nextElementSibling;
  assert.deepEqual(
    [...items.children].map((item) => item.textContent),
    ["자유연기독백1편1분 30초60%1단계현대극만", "노래선택2분", "mime30초"],
  );

  assert.equal(text("자유연기 1분 30초"), "자유연기 1분 30초");
  assert.equal(text("편한 옷"), "편한 옷");
  assert.equal(text("신분증"), "신분증");
  assert.equal(text("· 햄릿"), "· 햄릿");
  assert.equal(text("1. 지원 동기"), "1. 지원 동기");
  assert.equal(text("요강은 바뀔 수 있어요."), "요강은 바뀔 수 있어요.");
  assert.equal(
    within(card).getByRole("link", { name: "원문 공고 보기 ↗" }).getAttribute("href"),
    "https://admission.example.ac.kr/2027",
  );
});

test("지난 입시결과는 전형별로 학년도를 쌓고, 공개하지 않은 해도 그렇다고 적는다", () => {
  serve(() => new Promise(() => {}));
  renderDetail();
  const history = section("지난 입시결과");
  const cards = [...history.querySelectorAll(".rounded-2xl")];

  assert.equal(within(cards[0]).getByText("정시 실기").textContent, "정시 실기");
  assert.equal(within(cards[1]).getByText("수시 · 실기우수자").textContent, "수시 · 실기우수자");
  assert.deepEqual(
    within(cards[1]).getAllByText(/학년도$/).map((year) => [year.textContent, year.nextElementSibling.textContent]),
    [
      ["2026학년도", "30.5:1"],
      ["2025학년도", "경쟁률 미공개"],
      ["2024학년도", "공개 안 함"],
    ],
  );
  assert.equal(
    within(cards[1]).getByText(/^모집 20명/).textContent,
    "모집 20명 · 지원 1,610명 · 학생부 평균 3.2 · 50%컷 3.0 · 70%컷 3.5 · 최저 4.1 · 충원율 50% · 예비 3번까지 · 추가합격 5명",
  );
  assert.equal(within(cards[1]).getByText("추가합격 없음").textContent, "추가합격 없음");
  assert.equal(
    within(cards[1]).getByText(/^실기 평균/).textContent,
    "실기 평균 85 · 50%컷 84 · 70%컷 80",
  );
  assert.equal(within(cards[1]).getByText("입학처 공개 자료").textContent, "입학처 공개 자료");
  assert.equal(
    within(cards[1]).getByRole("link", { name: "입학처 원문 ↗" }).getAttribute("href"),
    "https://admission.example.ac.kr/result",
  );
});

test("후기는 응시 학년도별로, 참고 영상은 출처를 밝혀 싣고 가이드 글로 잇는다", () => {
  serve(() => new Promise(() => {}));
  renderDetail();
  const tips = section("먼저 다녀온 사람들 이야기");

  assert.deepEqual(
    within(tips).getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ["2026학년도 응시 후기", "응시 연도를 밝히지 않은 후기"],
  );
  assert.equal(within(tips).getByText("시험 당일").textContent, "시험 당일");
  assert.equal(within(tips).getByText("그 밖에").textContent, "그 밖에");
  assert.equal(within(tips).getByText("후기 3건에서 확인").textContent, "후기 3건에서 확인");
  assert.equal(within(tips).getByText("cafe.example.com").textContent, "cafe.example.com");
  assert.equal(within(tips).getByRole("link", { name: "출처 ↗" }).getAttribute("href"), "https://cafe.example.com/1");
  assert.equal(within(tips).getByText("입시학원").textContent, "입시학원");

  const official = screen.getByRole("link", { name: /2026 실기 시범/ });
  assert.equal(official.getAttribute("href"), "https://youtu.be/a");
  assert.equal(official.textContent, "대학 공식서울예술대 입학처2026 실기 시범학교가 올린 영상");
  assert.equal(
    screen.getByRole("link", { name: /합격 후기 영상/ }).textContent,
    "입시학원OO연기학원합격 후기 영상",
  );
  assert.equal(
    screen.getByRole("link", { name: "대본 장면 분석 기본" }).getAttribute("href"),
    "/blog/scene-analysis-basics",
  );
});

test("공고가 없는 대학은 대학 메모나 기본 안내를, 없는 대학은 찾을 수 없다고 한다", () => {
  serve(() => new Promise(() => {}));
  renderDetail(
    normalizeAdmissions({ ...payload, universities: [{ ...university, note: "올해 모집 안 함", tips: [], resources: [] }], notices: [] }),
  );
  assert.equal(screen.getByText("올해 모집 안 함").textContent, "올해 모집 안 함");
  assert.equal(screen.queryByText("한눈에 보기"), null);
  assert.equal(screen.queryByText("지난 입시결과"), null);
  cleanup();

  renderDetail(normalizeAdmissions({ ...payload, universities: [{ ...university, tips: [], resources: [] }], notices: [] }));
  assert.equal(
    screen.getByText("아직 전형 정보를 확인하지 못했어요. 입학처 원문에서 확인해 주세요.").textContent,
    "아직 전형 정보를 확인하지 못했어요. 입학처 원문에서 확인해 주세요.",
  );
  cleanup();

  renderDetail(normalizeAdmissions({ ...payload, universities: [], notices: [] }), null);
  assert.equal(screen.getByText("해당 대학을 찾을 수 없어요.").textContent, "해당 대학을 찾을 수 없어요.");
});

test("조회가 실패하면 프리렌더 본문 위에 다시 시도하라는 한 줄을 띄운다", async () => {
  serve(json({}, 500));
  renderDetail();

  await waitFor(() =>
    assert.equal(
      screen.getByText("입시 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.").textContent,
      "입시 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    ),
  );
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "서울예술대");
});
