import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  groupByUniversity,
  isOpen,
  countdown,
  matchesQuery,
  filterGroups,
  availableFacets,
  activeFilterCount,
  broadRegion,
  weightBars,
  normalizeAdmissions,
  hasNoCsatMinimum,
  EMPTY_FILTERS,
} = await import("../src/lib/api/v2/admissions.ts");

const payload = {
  updated_at: "2026-07-31",
  disclaimer: "최종 확인은 반드시 각 대학 입학처 공고로 해주세요.",
  universities: [
    { id: "sejong", name: "세종대학교", admission_url: "https://ipsi.sejong.ac.kr" },
    { id: "cau", name: "중앙대학교", admission_url: "https://admission.cau.ac.kr" },
  ],
  notices: [
    { id: "a", university_id: "sejong", apply_end: "2026-09-11" },
    { id: "b", university_id: "sejong", apply_end: null },
  ],
};

test("공고를 대학별로 묶는다", () => {
  const grouped = groupByUniversity(payload);
  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped[0].notices.map((n) => n.id),
    ["a", "b"],
  );
});

// 공고가 아직 없는 대학도 목록에서 빠지면 안 된다. 입학처 링크만이라도 보여주는 게
// 이 화면의 최소 가치다.
test("공고가 없는 대학도 남는다", () => {
  const grouped = groupByUniversity(payload);
  const cau = grouped.find((g) => g.university.id === "cau");
  assert.ok(cau);
  assert.deepEqual(cau.notices, []);
});

test("접수 마감일이 지나지 않았으면 열린 것으로 본다", () => {
  assert.equal(isOpen({ apply_end: "2026-09-11" }, "2026-09-10"), true);
  assert.equal(isOpen({ apply_end: "2026-09-11" }, "2026-09-11"), true);
  assert.equal(isOpen({ apply_end: "2026-09-11" }, "2026-09-12"), false);
});

// 확인하지 못한 날짜를 "마감"으로 단정하면 사용자가 지원 기회를 놓친다.
test("마감일이 비어 있으면 닫힌 것으로 단정하지 않는다", () => {
  assert.equal(isOpen({ apply_end: null }, "2026-12-31"), true);
  assert.equal(isOpen({}, "2026-12-31"), true);
});

// 입시생에게 가장 급한 건 마감일이다. 알파벳순으로 세우면 이 화면이 쓸모없어진다.
test("접수가 빠른 대학이 앞에 온다", () => {
  const grouped = groupByUniversity({
    ...payload,
    universities: [
      { id: "late", name: "늦은대", admission_url: "https://late.example" },
      { id: "early", name: "이른대", admission_url: "https://early.example" },
      { id: "unknown", name: "미확인대", admission_url: "https://unknown.example" },
    ],
    notices: [
      { id: "l", university_id: "late", apply_start: "2026-09-14" },
      { id: "e", university_id: "early", apply_start: "2026-06-22" },
      { id: "u", university_id: "unknown", apply_start: null },
    ],
  });
  assert.deepEqual(
    grouped.map((g) => g.university.id),
    ["early", "late", "unknown"],
  );
});

test("접수 전이면 시작까지, 접수 중이면 마감까지 센다", () => {
  const notice = { apply_start: "2026-09-08", apply_end: "2026-09-11" };
  assert.deepEqual(countdown(notice, "2026-08-29"), { label: "접수 시작", days: 10 });
  assert.deepEqual(countdown(notice, "2026-09-09"), { label: "접수 마감", days: 2 });
  assert.deepEqual(countdown(notice, "2026-09-11"), { label: "접수 마감", days: 0 });
});

// 이미 끝났거나 날짜를 모르는 공고에 D-day를 붙이면 거짓말이 된다.
test("끝났거나 날짜가 없으면 카운트다운을 붙이지 않는다", () => {
  assert.equal(countdown({ apply_start: "2026-09-08", apply_end: "2026-09-11" }, "2026-09-12"), null);
  assert.equal(countdown({ apply_start: null, apply_end: null }, "2026-09-12"), null);
});

// 이미 끝난 전형이 맨 위에 있으면, 지금 지원할 수 있는 곳을 못 찾는다.
test("접수가 끝난 전형은 뒤로 내려간다", () => {
  const grouped = groupByUniversity(
    {
      ...payload,
      universities: [
        { id: "done", name: "끝난대", admission_url: "https://done.example" },
        { id: "soon", name: "곧대", admission_url: "https://soon.example" },
      ],
      notices: [
        { id: "d", university_id: "done", apply_start: "2026-06-22", apply_end: "2026-06-25" },
        { id: "s", university_id: "soon", apply_start: "2026-09-08", apply_end: "2026-09-11" },
      ],
    },
    "2026-07-31",
  );
  assert.deepEqual(
    grouped.map((g) => g.university.id),
    ["soon", "done"],
  );
});

// 대학이 열다섯 곳이라 검색이 없으면 원하는 학교를 못 찾는다.
test("대학명·지역·학과 어느 쪽으로도 검색된다", () => {
  const uni = { id: "kyonggi", name: "경기대학교", region: "경기 수원", admission_url: "x" };
  const notices = [{ id: "a", university_id: "kyonggi", department: "연기학과" }];
  assert.equal(matchesQuery(uni, notices, "경기대"), true);
  assert.equal(matchesQuery(uni, notices, "수원"), true);
  assert.equal(matchesQuery(uni, notices, "연기"), true);
  assert.equal(matchesQuery(uni, notices, "  "), true);
  assert.equal(matchesQuery(uni, notices, "무용"), false);
});

// 학과가 아직 안 채워진 대학도 이름으로는 찾을 수 있어야 한다.
test("공고가 없는 대학도 이름으로 검색된다", () => {
  const uni = { id: "kbu", name: "경복대학교", region: "경기 남양주", admission_url: "x" };
  assert.equal(matchesQuery(uni, [], "경복"), true);
  assert.equal(matchesQuery(uni, [], "남양주"), true);
});

// ---- 필터 ----
// 대학이 쉰 곳으로 늘면 검색만으로는 못 좁힌다. 아래는 필터 축별 계약이다.

const filterPayload = {
  updated_at: "2026-08-04",
  disclaimer: "d",
  universities: [
    {
      id: "seoul-univ",
      name: "서울대학",
      region: "서울 종로",
      type: "univ",
      admission_url: "x",
    },
    {
      id: "gyeonggi-col",
      name: "경기전문대",
      region: "경기 용인",
      type: "college",
      admission_url: "x",
    },
  ],
  notices: [
    {
      id: "s1",
      university_id: "seoul-univ",
      track: "수시",
      discipline: "acting",
      csat_minimum: "국어 3등급",
      practical_items: [{ category: "free_acting" }, { category: "song" }],
    },
    {
      id: "g1",
      university_id: "gyeonggi-col",
      track: "정시",
      discipline: "musical",
      csat_minimum: "없음",
      practical_items: [{ category: "dance" }],
    },
  ],
};

const withFilters = (overrides) => ({ ...EMPTY_FILTERS, ...overrides });
const idsOf = (groups) => groups.map((g) => g.university.id);

test("광역 지역만 뽑아 필터 선택지를 열 개 안쪽으로 줄인다", () => {
  assert.equal(broadRegion("경기 용인"), "경기");
  assert.equal(broadRegion("서울 종로"), "서울");
  assert.equal(broadRegion(null), null);
  assert.equal(broadRegion("  "), null);
});

test("지역·설립형태로 대학을 거른다", () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ regions: ["서울"] }))), [
    "seoul-univ",
  ]);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ types: ["college"] }))), [
    "gyeonggi-col",
  ]);
});

test("수시·정시와 연기·뮤지컬로 공고를 거른다", () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ tracks: ["수시"] }))), [
    "seoul-univ",
  ]);
  assert.deepEqual(
    idsOf(filterGroups(groups, withFilters({ disciplines: ["musical"] }))),
    ["gyeonggi-col"],
  );
});

// "자유연기 보는 데만" 같은 탐색이 이 화면을 쓰는 이유다.
test("실기 종목은 하나라도 겹치면 통과한다", () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(
    idsOf(filterGroups(groups, withFilters({ practicals: ["free_acting"] }))),
    ["seoul-univ"],
  );
  // 여러 개를 고르면 OR — 자유연기나 무용 중 하나만 봐도 남는다.
  assert.deepEqual(
    idsOf(filterGroups(groups, withFilters({ practicals: ["free_acting", "dance"] }))),
    ["seoul-univ", "gyeonggi-col"],
  );
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ practicals: ["improv"] }))), []);
});

test("수능 최저가 없는 전형만 남긴다", () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ noCsatOnly: true }))), [
    "gyeonggi-col",
  ]);
});

// 확인하지 못한 대학이 "필터를 켰다"는 이유로 사라지면, 없는 것과 모르는 것을
// 구분할 수 없다. 필터를 안 켰을 때는 반드시 남는다.
test("필터를 안 켜면 공고 없는 대학도 남고, 켜면 빠진다", () => {
  const empty = {
    ...filterPayload,
    universities: [
      ...filterPayload.universities,
      { id: "unknown", name: "미확인대", region: "인천 남동", admission_url: "x" },
    ],
  };
  const groups = groupByUniversity(empty);
  assert.ok(idsOf(filterGroups(groups, EMPTY_FILTERS)).includes("unknown"));
  assert.ok(!idsOf(filterGroups(groups, withFilters({ tracks: ["수시"] }))).includes("unknown"));
});

// 결과가 0건만 나오는 칩을 띄우면 사용자가 데이터를 의심하게 된다.
test("필터 선택지는 데이터에 실제로 있는 값만 낸다", () => {
  const facets = availableFacets(filterPayload);
  assert.deepEqual(facets.regions, ["경기", "서울"]);
  assert.deepEqual(facets.types, ["college", "univ"]);
  assert.deepEqual(facets.tracks, ["수시", "정시"]);
  assert.deepEqual(facets.disciplines, ["acting", "musical"]);
  // 실기 종목은 입력 순서가 아니라 정해진 순서로 — 대학을 추가할 때마다
  // 칩 순서가 바뀌면 안 된다.
  assert.deepEqual(facets.practicals, ["free_acting", "song", "dance"]);
});

test("켜져 있는 필터 개수를 센다", () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(
    activeFilterCount(withFilters({ regions: ["서울", "경기"], openOnly: true })),
    3,
  );
  // 검색어는 입력창에 그대로 보이므로 배지에서 두 번 세지 않는다.
  assert.equal(activeFilterCount(withFilters({ query: "중앙대" })), 0);
});

test("반영비율은 값이 있는 항목만 실기부터 순서대로 그린다", () => {
  assert.deepEqual(weightBars({ practical: 70, transcript: 30, csat: null }), [
    { key: "practical", label: "실기", value: 70 },
    { key: "transcript", label: "학생부", value: 30 },
  ]);
  // 1단계 성적 미반영(0%)은 막대로 그려도 보이지 않는다.
  assert.deepEqual(weightBars({ practical: 0 }), []);
  assert.deepEqual(weightBars(null), []);
});

// 마감 키("9:")가 미확인 키("8:")보다 커서, reduce 초기값을 미확인으로 두면
// 공고가 전부 끝난 대학이 '확인 중'인 대학과 같은 자리로 묶여 버렸다.
test("공고가 전부 마감된 대학은 날짜 미확인 대학보다도 뒤에 온다", () => {
  const grouped = groupByUniversity(
    {
      ...payload,
      universities: [
        { id: "done", name: "끝난대", admission_url: "x" },
        { id: "unknown", name: "미확인대", admission_url: "x" },
        { id: "soon", name: "곧대", admission_url: "x" },
      ],
      notices: [
        { id: "d", university_id: "done", apply_start: "2026-06-22", apply_end: "2026-06-25" },
        { id: "u", university_id: "unknown", apply_start: null, apply_end: null },
        { id: "s", university_id: "soon", apply_start: "2026-09-07", apply_end: "2026-09-11" },
      ],
    },
    "2026-08-01",
  );
  assert.deepEqual(
    grouped.map((g) => g.university.id),
    ["soon", "unknown", "done"],
  );
});

// API가 리스트 필드를 빠뜨리면 화면이 `notice.stages.length`에서 죽는다. 공고 하나가
// 덜 보이는 것과 흰 화면은 무게가 다르다 — 들어오는 자리에서 메운다.
test("응답에 리스트 필드가 없어도 빈 배열로 채운다", () => {
  const filled = normalizeAdmissions({
    updated_at: "2026-08-04",
    disclaimer: "d",
    universities: [{ id: "a", name: "가", admission_url: "x" }],
    notices: [{ id: "n", university_id: "a" }],
  });
  assert.deepEqual(filled.universities[0].resources, []);
  const notice = filled.notices[0];
  for (const key of [
    "designated_works",
    "essay_questions",
    "stages",
    "practical_items",
    "results",
  ]) {
    assert.deepEqual(notice[key], [], key);
  }
});

test("이미 들어 있는 리스트는 그대로 둔다", () => {
  const filled = normalizeAdmissions({
    updated_at: "2026-08-04",
    disclaimer: "d",
    universities: [],
    notices: [{ id: "n", university_id: "a", stages: [{ order: 1, name: "1차" }] }],
  });
  assert.equal(filled.notices[0].stages.length, 1);
});

// 빈 csat_minimum 은 "수능 최저가 없다"가 아니라 "아직 확인 못 했다"는 뜻이다.
// 이걸 없음으로 세면 확인도 안 한 전형을 "수능 안 봐도 돼요"라고 단정하게 된다.
test("수능 최저는 '없음'이라고 확인된 것만 없음으로 센다", () => {
  assert.equal(hasNoCsatMinimum({ csat_minimum: "없음" }), true);
  assert.equal(hasNoCsatMinimum({ csat_minimum: "없음 (수시는 반영하지 않는다)" }), true);
  assert.equal(hasNoCsatMinimum({ csat_minimum: "미적용" }), true);
  assert.equal(hasNoCsatMinimum({ csat_minimum: "국어 3등급" }), false);
  assert.equal(hasNoCsatMinimum({ csat_minimum: null }), false);
  assert.equal(hasNoCsatMinimum({ csat_minimum: "  " }), false);
  assert.equal(hasNoCsatMinimum({}), false);
});

test("수능 최저 없음 필터는 미확인 전형을 남기지 않는다", () => {
  const groups = groupByUniversity({
    updated_at: "x", disclaimer: "d",
    universities: [
      { id: "known", name: "확인대", admission_url: "x" },
      { id: "unknown", name: "미확인대", admission_url: "x" },
    ],
    notices: [
      { id: "k", university_id: "known", csat_minimum: "없음" },
      { id: "u", university_id: "unknown", csat_minimum: null },
    ],
  });
  assert.deepEqual(
    filterGroups(groups, { ...EMPTY_FILTERS, noCsatOnly: true }).map((g) => g.university.id),
    ["known"],
  );
});
