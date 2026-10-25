// app.audition — /auditions 화면을 실제로 그려, 공용 상단 바로 들어온 방문자가 공고를 받아 보고, 검색·분야·조건으로
// 좁히고, 찜·봤음을 이 브라우저에 남기는 흐름을 본다. 순수 계산은 auditions.test.mjs 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { resetNavigation } from "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AuditionsPage } = await import("../src/features/auditions/auditions-page.tsx");
const { readMarks, writeMarks } = await import("../src/features/auditions/marks.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;
const DAY_MS = 86_400_000;

/** 오늘(KST)에서 days 만큼 떨어진 날짜. 화면은 응답을 받은 순간의 한국 날짜로 D-day 를 잰다. */
const kstDay = (days = 0) => new Date(Date.now() + 9 * 3_600_000 + days * DAY_MS).toISOString().slice(0, 10);

const posting = (overrides = {}) => ({
  id: "otr-1",
  title: "[연극] 낭독극 배우 모집",
  category: "theater",
  source: "otr",
  source_name: "OTR",
  pay_text: null,
  apply_start: null,
  apply_end: kstDay(2),
  status_text: null,
  posted_on: kstDay(-5),
  source_url: "https://otr.co.kr/audition/?vid=1",
  ...overrides,
});

const ITEMS = [
  posting({ id: "otr-1", title: "낭독극 배우 모집", apply_end: kstDay(2) }),
  posting({
    id: "shinsee-2",
    title: "단편영화 주연",
    category: "short_film",
    source: "shinsee",
    source_name: "신시컴퍼니",
    pay_text: "회당 30만원",
    apply_end: kstDay(10),
    source_url: "https://shinsee.example/2",
  }),
  posting({
    id: "emk-3",
    title: "뮤지컬 앙상블",
    category: "musical",
    source: "emk",
    source_name: "EMK",
    pay_text: "협의",
    apply_end: null,
    posted_on: kstDay(0),
    source_url: "https://emk.example/3",
  }),
];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

/** 응답을 차례로 준다. 받은 요청의 경로와 인증 헤더를 적는다. */
function serve(...responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ route: `${init.method ?? "GET"} ${String(url)}`, authorization: new Headers(init.headers).get("Authorization") });
    const next = responses.shift();
    if (!next) throw new Error(`예상하지 못한 요청: ${String(url)}`);
    return next();
  };
  return calls;
}

const cardTitles = () => screen.queryAllByRole("link", { name: / 원문 열기$/ }).map((link) => link.getAttribute("aria-label"));
/** 맨 아래 안내 문단. 출처가 있으면 「출처: …」 줄이 붙는다. */
const footnote = () => screen.getByText((_, element) => element.tagName === "P" && element.textContent.startsWith("이 화면은 공고 목록의"));
const toggle = (name) => screen.getByRole("button", { name });

// 카드는 원문을 새 탭으로 연다. jsdom 은 이동을 하지 않으므로 기본 동작만 막고 화면 쪽 처리를 본다.
const blockNavigation = (event) => event.preventDefault();

beforeEach(() => {
  window.localStorage.clear();
  resetNavigation("/auditions");
  window.document.addEventListener("click", blockNavigation);
});

afterEach(() => {
  cleanup();
  window.document.removeEventListener("click", blockNavigation);
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

test("app.audition: 공용 상단 바 아래에서 공고를 로그인 없이 받아 마감 구간별로 보여 준다", async () => {
  const calls = serve(() => jsonResponse({ items: ITEMS, collected_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }));
  render(h(AuditionsPage));

  assert.equal(screen.getByText("공고를 불러오고 있어요.").tagName, "P");
  const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
  assert.deepEqual(
    within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")]),
    [
      ["홈", "/practice/new", null],
      ["리딩", "/reading", null],
      ["입시", "/admissions", null],
      ["오디션", "/auditions", "page"],
      ["앱", "/app", null],
      ["로그인", "/login", null],
    ],
  );

  await screen.findByText("지원 가능 3건 · 3시간 전 수집");
  assert.deepEqual(calls, [{ route: "GET /v2/auditions", authorization: null }]);
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ["이번 주 마감 · 1", "2주 안 · 1", "마감일은 원문 확인 · 1"],
  );
  assert.deepEqual(cardTitles(), ["낭독극 배우 모집 원문 열기", "단편영화 주연 원문 열기", "뮤지컬 앙상블 원문 열기"]);
  const card = screen.getByRole("link", { name: "단편영화 주연 원문 열기" });
  assert.equal(card.getAttribute("href"), "https://shinsee.example/2");
  assert.equal(card.getAttribute("target"), "_blank");
  assert.equal(card.textContent.includes("D-10"), true);
  assert.equal(card.textContent.includes("출연료 회당 30만원"), true);
  const musical = screen.getByRole("link", { name: "뮤지컬 앙상블 원문 열기" });
  assert.equal(musical.textContent.includes("NEW"), true);
  assert.equal(musical.textContent.includes("미표기원문 확인"), true);
  assert.equal(footnote().textContent.endsWith("원문 기준이에요.출처: OTR · 신시컴퍼니 · EMK"), true);
  assert.deepEqual(
    within(screen.getByLabelText("분야")).getAllByRole("button").map((chip) => chip.textContent),
    ["전체 3", "영화·드라마 1", "연극 1", "뮤지컬 1"],
  );
});

test("app.audition: 검색·분야·조건으로 좁히고 필터 초기화로 되돌린다", async () => {
  serve(() => jsonResponse({ items: ITEMS, collected_at: null }));
  render(h(AuditionsPage));
  await screen.findByText("지원 가능 3건");
  assert.equal(screen.queryByRole("button", { name: "필터 초기화" }), null);

  fireEvent.change(screen.getByRole("searchbox", { name: "공고 검색" }), { target: { value: "신시 주연" } });
  assert.deepEqual(cardTitles(), ["단편영화 주연 원문 열기"]);
  assert.equal(screen.getByText("1건").tagName, "P");

  fireEvent.click(toggle("필터 초기화"));
  assert.equal(screen.getByRole("searchbox", { name: "공고 검색" }).value, "");
  assert.equal(cardTitles().length, 3);

  fireEvent.click(toggle("뮤지컬 1"));
  assert.equal(toggle("뮤지컬 1").getAttribute("aria-pressed"), "true");
  assert.deepEqual(cardTitles(), ["뮤지컬 앙상블 원문 열기"]);
  fireEvent.click(toggle("전체 3"));

  fireEvent.click(toggle("7일 안에 마감"));
  assert.equal(toggle("7일 안에 마감").getAttribute("aria-pressed"), "true");
  assert.deepEqual(cardTitles(), ["낭독극 배우 모집 원문 열기"]);
  fireEvent.click(toggle("7일 안에 마감"));

  // 「협의」는 금액이 아니다.
  fireEvent.click(toggle("출연료 명시"));
  assert.deepEqual(cardTitles(), ["단편영화 주연 원문 열기"]);

  fireEvent.change(screen.getByRole("searchbox", { name: "공고 검색" }), { target: { value: "뮤지컬" } });
  assert.deepEqual(cardTitles(), []);
  assert.equal(screen.getByText("조건에 맞는 공고가 없어요.").tagName, "P");
});

test("app.audition: 찜은 이 브라우저에 남고 찜한 공고만 볼 수 있다", async () => {
  serve(() => jsonResponse({ items: ITEMS, collected_at: null }));
  render(h(AuditionsPage));
  await screen.findByText("지원 가능 3건");

  fireEvent.click(toggle("★ 찜한 공고"));
  assert.equal(screen.getByText("찜한 공고가 없어요.", { exact: false }).textContent, "찜한 공고가 없어요.카드 오른쪽 별을 눌러 모아 두세요.");
  fireEvent.click(toggle("★ 찜한 공고"));

  const stars = screen.getAllByRole("button", { name: "찜하기" });
  fireEvent.click(stars[1]);
  assert.equal(screen.getByRole("button", { name: "찜 해제" }).getAttribute("aria-pressed"), "true");
  assert.equal(window.localStorage.getItem("acttub.auditions.starred"), JSON.stringify(["shinsee-2"]));

  fireEvent.click(toggle("★ 찜한 공고"));
  assert.deepEqual(cardTitles(), ["단편영화 주연 원문 열기"]);

  fireEvent.click(screen.getByRole("button", { name: "찜 해제" }));
  assert.equal(window.localStorage.getItem("acttub.auditions.starred"), "[]");
  assert.deepEqual(cardTitles(), []);
});

test("app.audition: 원문을 연 카드는 봤음으로 표시되고, 다시 열어도 찜·봤음이 남아 있다", async () => {
  window.localStorage.setItem("acttub.auditions.starred", JSON.stringify(["emk-3"]));
  serve(
    () => jsonResponse({ items: ITEMS, collected_at: null }),
    () => jsonResponse({ items: ITEMS, collected_at: null }),
  );
  const first = render(h(AuditionsPage));
  await screen.findByText("지원 가능 3건");
  assert.equal(screen.getAllByRole("button", { name: "찜 해제" }).length, 1);
  assert.equal(screen.queryByText("· 봤음"), null);

  fireEvent.click(screen.getByRole("link", { name: "낭독극 배우 모집 원문 열기" }));
  assert.equal(within(screen.getByRole("link", { name: "낭독극 배우 모집 원문 열기" })).getByText("· 봤음").tagName, "SPAN");
  assert.equal(window.localStorage.getItem("acttub.auditions.seen"), JSON.stringify(["otr-1"]));

  first.unmount();
  render(h(AuditionsPage));
  await screen.findByText("지원 가능 3건");
  assert.equal(within(screen.getByRole("link", { name: "낭독극 배우 모집 원문 열기" })).getByText("· 봤음").tagName, "SPAN");
  assert.equal(
    within(screen.getByRole("link", { name: "뮤지컬 앙상블 원문 열기" }).closest("article")).getByRole("button", { name: "찜 해제" }).tagName,
    "BUTTON",
  );
});

test("app.audition: 못 불러오면 알리고, 다시 시도하면 다시 묻는다", async () => {
  const calls = serve(
    () => jsonResponse({ detail: "internal_error" }, 500),
    () => jsonResponse({ items: [], collected_at: null }),
  );
  render(h(AuditionsPage));

  assert.equal((await screen.findByText("오디션 공고를 불러오지 못했어요.")).tagName, "P");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  assert.equal((await screen.findByText(/지금 지원할 수 있는 공고가 없어요\./)).textContent, "지금 지원할 수 있는 공고가 없어요.하루 두 번 새로 모아요.");
  assert.deepEqual(calls.map(({ route }) => route), ["GET /v2/auditions", "GET /v2/auditions"]);
  assert.equal(footnote().textContent.includes("출처"), false);
});

test("app.audition: 봤음은 최근 500개만 남기고, 브라우저 저장소를 못 쓰면 빈 표시로 동작한다", async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
  writeMarks("seen", new Set(ids));
  const kept = readMarks("seen");
  assert.equal(kept.size, 500);
  assert.equal(kept.has("id-0"), false);
  assert.equal(kept.has("id-500"), true);

  // 찜은 개수를 자르지 않는다.
  writeMarks("starred", new Set(ids));
  assert.equal(readMarks("starred").size, 501);

  // 사생활 보호 창처럼 localStorage 를 여는 것부터 막힌 브라우저.
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    assert.deepEqual([...readMarks("starred")], []);
    assert.doesNotThrow(() => writeMarks("starred", new Set(["a"])));
  } finally {
    Object.defineProperty(window, "localStorage", descriptor);
  }

  // 프리렌더(서버)에는 window 가 없다. 찜·봤음은 빈 집합이고 저장은 조용히 넘어간다.
  const browserWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.deepEqual([...readMarks("seen")], []);
    assert.doesNotThrow(() => writeMarks("seen", new Set(["a"])));
  } finally {
    globalThis.window = browserWindow;
  }
  assert.equal(readMarks("seen").has("a"), false);
});
