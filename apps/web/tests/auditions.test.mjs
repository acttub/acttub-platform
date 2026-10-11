// app.audition — 오디션 공고 모아보기 웹 화면(/auditions). 모바일(apps/mobile/lib/auditions.ts)과
// 같은 순수 계산을 웹에서도 같은 답으로 내는지, 본문이 상태마다 무엇을 보이는지 못박는다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
  kstDate,
  daysUntil,
  groupOf,
  groupCounts,
  deadlineBucket,
  hasPay,
  isNewPosting,
  matchesAuditionQuery,
  filterAuditions,
  auditionSections,
  collectedAgo,
  ddayLabel,
  EMPTY_AUDITION_FILTERS,
} = await import("../src/features/auditions/audition-list.ts");
const { normalizeAuditions } = await import("../src/lib/api/v2/auditions.ts");
const { readMarks, writeMarks } = await import("../src/features/auditions/marks.ts");
const { AuditionsBody } = await import("../src/features/auditions/auditions-body.tsx");

const TODAY = "2026-10-08";

const posting = (overrides = {}) => ({
  id: "otr-1",
  title: "[연극] 낭독극 배우 모집",
  category: "theater",
  source: "otr",
  source_name: "OTR",
  pay_text: null,
  apply_start: null,
  apply_end: "2026-10-10",
  status_text: null,
  posted_on: "2026-10-07",
  source_url: "https://otr.co.kr/audition/?vid=1",
  ...overrides,
});

test("kstDate는 기기 시간대가 아니라 한국 시간으로 날짜를 자른다", () => {
  // UTC 10/7 15:30 = KST 10/8 00:30
  assert.equal(kstDate(new Date("2026-10-07T15:30:00Z")), "2026-10-08");
  assert.equal(kstDate(new Date("2026-10-07T14:59:00Z")), "2026-10-07");
});

test("daysUntil은 오늘 0, 지난 날 음수, 없거나 못 읽으면 null", () => {
  assert.equal(daysUntil("2026-10-08", TODAY), 0);
  assert.equal(daysUntil("2026-10-15", TODAY), 7);
  assert.equal(daysUntil("2026-10-07", TODAY), -1);
  assert.equal(daysUntil(null, TODAY), null);
  assert.equal(daysUntil("모름", TODAY), null);
});

test("분야 칩: 화면·광고 묶음, 모르는 분야는 기타, 0건 칩은 빼되 전체는 남긴다", () => {
  assert.equal(groupOf("web_drama"), "screen");
  assert.equal(groupOf("music_video"), "ad");
  assert.equal(groupOf("hologram"), "other");
  assert.deepEqual(
    groupCounts([
      posting({ category: "film" }),
      posting({ category: "drama" }),
      posting({ category: "musical" }),
    ]),
    [
      { key: "all", count: 3 },
      { key: "screen", count: 2 },
      { key: "musical", count: 1 },
    ],
  );
  assert.deepEqual(groupCounts([]), [{ key: "all", count: 0 }]);
});

test("마감 구간: 7일 이하 이번 주, 14일 이하 2주 안, 그 뒤 여유, 날짜 없으면 원문 확인", () => {
  assert.equal(deadlineBucket(posting({ apply_end: "2026-10-15" }), TODAY), "week");
  assert.equal(deadlineBucket(posting({ apply_end: "2026-10-22" }), TODAY), "twoWeeks");
  assert.equal(deadlineBucket(posting({ apply_end: "2026-10-23" }), TODAY), "later");
  assert.equal(deadlineBucket(posting({ apply_end: null }), TODAY), "unknown");
});

test("출연료 명시는 문구가 있고 「협의」로 시작하지 않을 때만", () => {
  assert.equal(hasPay(posting({ pay_text: "회당 30만원" })), true);
  assert.equal(hasPay(posting({ pay_text: "협의 후 결정" })), false);
  assert.equal(hasPay(posting({ pay_text: "  " })), false);
  assert.equal(hasPay(posting({ pay_text: null })), false);
});

test("NEW는 오늘·어제 게시(모바일과 같은 「1일 이내」)", () => {
  assert.equal(isNewPosting(posting({ posted_on: "2026-10-08" }), TODAY), true);
  assert.equal(isNewPosting(posting({ posted_on: "2026-10-07" }), TODAY), true);
  assert.equal(isNewPosting(posting({ posted_on: "2026-10-06" }), TODAY), false);
});

test("검색은 제목·출연료·출처에서 공백으로 나눈 말이 모두 있어야 남긴다", () => {
  const item = posting({ pay_text: "회당 30만원", source_name: "세종문화회관" });
  assert.equal(matchesAuditionQuery(item, "낭독극 세종"), true);
  assert.equal(matchesAuditionQuery(item, "낭독극 뮤지컬"), false);
  assert.equal(matchesAuditionQuery(item, "  "), true);
});

test("필터: 지난 마감은 늘 빼고, 7일·출연료·찜·분야를 함께 건다", () => {
  const items = [
    posting({ id: "a", apply_end: "2026-10-07" }),
    posting({ id: "b", apply_end: "2026-10-12", pay_text: "50만원" }),
    posting({ id: "c", apply_end: "2026-11-30", category: "film" }),
    posting({ id: "d", apply_end: null }),
  ];
  const ids = (filters, starred = new Set()) =>
    filterAuditions(items, { ...EMPTY_AUDITION_FILTERS, ...filters }, TODAY, starred).map(
      ({ id }) => id,
    );
  assert.deepEqual(ids({}), ["b", "c", "d"]);
  assert.deepEqual(ids({ week: true }), ["b"]);
  assert.deepEqual(ids({ paid: true }), ["b"]);
  assert.deepEqual(ids({ group: "screen" }), ["c"]);
  assert.deepEqual(ids({ starred: true }, new Set(["d"])), ["d"]);
});

test("구간은 화면 순서대로, 빈 구간 없이, 안에서는 마감 빠른 순·같으면 최근 게시 순", () => {
  const sections = auditionSections(
    [
      posting({ id: "late", apply_end: "2026-12-01" }),
      posting({ id: "x", apply_end: "2026-10-10", posted_on: "2026-10-01" }),
      posting({ id: "y", apply_end: "2026-10-10", posted_on: "2026-10-05" }),
      posting({ id: "w", apply_end: "2026-10-09" }),
      posting({ id: "none", apply_end: null }),
    ],
    TODAY,
  );
  assert.deepEqual(
    sections.map(({ bucket, data }) => [bucket, data.map(({ id }) => id)]),
    [
      ["week", ["w", "y", "x"]],
      ["later", ["late"]],
      ["unknown", ["none"]],
    ],
  );
});

test("D-day 표시: 오늘은 D-DAY, 3일 안 급함, 7일 안 곧, 날짜 없으면 미표기", () => {
  assert.deepEqual(ddayLabel(posting({ apply_end: TODAY }), TODAY), {
    main: "D-DAY",
    sub: "10/8 마감",
    tone: "urgent",
  });
  assert.equal(ddayLabel(posting({ apply_end: "2026-10-11" }), TODAY).tone, "urgent");
  assert.equal(ddayLabel(posting({ apply_end: "2026-10-15" }), TODAY).tone, "soon");
  assert.deepEqual(ddayLabel(posting({ apply_end: "2026-10-20" }), TODAY), {
    main: "D-12",
    sub: "10/20 마감",
    tone: "calm",
  });
  assert.deepEqual(ddayLabel(posting({ apply_end: null }), TODAY), {
    main: "미표기",
    sub: "원문 확인",
    tone: "none",
  });
});

test("수집 시각은 지금으로부터 얼마 전인지로 읽는다", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  assert.equal(collectedAgo("2026-10-08T09:59:30Z", now), "방금");
  assert.equal(collectedAgo("2026-10-08T09:20:00Z", now), "40분 전");
  assert.equal(collectedAgo("2026-10-08T01:00:00Z", now), "9시간 전");
  assert.equal(collectedAgo("2026-10-05T10:00:00Z", now), "3일 전");
  assert.equal(collectedAgo(null, now), null);
  assert.equal(collectedAgo("엉망", now), null);
});

test("기능이 꺼진 서버·빠진 키도 빈 목록으로 받는다", () => {
  assert.deepEqual(normalizeAuditions({}), { items: [], collected_at: null });
  assert.deepEqual(normalizeAuditions(null), { items: [], collected_at: null });
});

test("찜·봤음 저장: 읽기 실패는 빈 집합, 쓰기 실패는 조용히 넘긴다", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  writeMarks("starred", new Set(["a", "b"]), storage);
  assert.deepEqual([...readMarks("starred", storage)], ["a", "b"]);
  assert.deepEqual([...readMarks("seen", storage)], []);

  store.set("acttub.auditions.starred", "{깨짐");
  assert.deepEqual([...readMarks("starred", storage)], []);

  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.deepEqual([...readMarks("starred", broken)], []);
  assert.doesNotThrow(() => writeMarks("seen", new Set(["a"]), broken));
  assert.deepEqual([...readMarks("seen", null)], []);
});

// ── 본문 ──
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, "");
const body = (props) =>
  renderToStaticMarkup(
    React.createElement(AuditionsBody, {
      status: "ready",
      items: [],
      collectedAt: null,
      today: TODAY,
      now: Date.parse("2026-10-08T10:00:00Z"),
      errorMessage: null,
      filters: EMPTY_AUDITION_FILTERS,
      starred: new Set(),
      seen: new Set(),
      onFilters: noop,
      onToggleStar: noop,
      onOpen: noop,
      onRetry: noop,
      ...props,
    }),
  );

test("본문: 불러오는 중·오류·빈 목록을 각각 말한다", () => {
  assert.equal(text(body({ status: "loading", today: null })).includes("불러오고 있어요"), true);
  const failed = text(
    body({ status: "failed", today: null, errorMessage: "오디션 공고를 불러오지 못했어요." }),
  );
  assert.equal(failed.includes("오디션 공고를 불러오지 못했어요."), true);
  assert.equal(failed.includes("다시 시도"), true);
  assert.equal(text(body({})).includes("지금 지원할 수 있는 공고가 없어요."), true);
});

test("본문: 공고는 마감 구간으로 묶이고 원문을 새 탭으로 연다", () => {
  const html = body({
    items: [
      posting({ id: "a", title: "<b>단편영화</b> 주연", category: "short_film", pay_text: "회당 30만원", posted_on: TODAY }),
      posting({ id: "b", apply_end: null, source_url: "https://emk.co.kr/n/2" }),
    ],
    collectedAt: "2026-10-08T07:00:00Z",
  });
  const t = text(html);
  for (const expected of [
    "이번 주 마감",
    "마감일은 원문 확인",
    "D-2",
    "NEW",
    "출연료 회당 30만원",
    "단편영화",
    "3시간 전 수집",
    "원문에서 확인",
  ]) {
    assert.equal(t.includes(expected), true, expected);
  }
  // 외부 제목은 글자로만 — 태그로 풀리지 않는다.
  assert.equal(html.includes("<b>단편영화</b>"), false);
  assert.equal(html.includes("&lt;b&gt;단편영화&lt;/b&gt;"), true);
  const anchors = html.match(/<a [^>]*>/g) ?? [];
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) {
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
});

test("본문: 필터에 걸린 게 없으면 조건 문구, 찜 필터면 찜 안내", () => {
  const items = [posting({ pay_text: null })];
  assert.equal(
    text(body({ items, filters: { ...EMPTY_AUDITION_FILTERS, paid: true } })).includes(
      "조건에 맞는 공고가 없어요.",
    ),
    true,
  );
  assert.equal(
    text(body({ items, filters: { ...EMPTY_AUDITION_FILTERS, starred: true } })).includes(
      "찜한 공고가 없어요.",
    ),
    true,
  );
});

test("/auditions는 sitemap에 없다", async () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  const { default: sitemap } = await import("../src/app/sitemap.ts");
  assert.equal(
    sitemap().some(({ url }) => new URL(url).pathname.startsWith("/auditions")),
    false,
  );
});
