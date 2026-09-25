import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { loadAdmissionsStatic, toAdmissionsListPayload } = await import(
  "../src/features/admissions/admissions-static.ts"
);
const {
  groupByUniversity,
  filterGroups,
  availableFacets,
  summaryLine,
  EMPTY_FILTERS,
} = await import("../src/lib/api/v2/admissions.ts");

const full = loadAdmissionsStatic();
const list = toAdmissionsListPayload(full);

test("목록 페이로드는 대학·공고 수와 목록이 읽는 값을 그대로 둔다", () => {
  assert.equal(list.universities.length, full.universities.length);
  assert.equal(list.notices.length, full.notices.length);
  assert.equal(list.updated_at, full.updated_at);
  assert.equal(list.disclaimer, full.disclaimer);

  full.universities.forEach((university, index) => {
    const slim = list.universities[index];
    assert.equal(slim.id, university.id);
    assert.equal(slim.name, university.name);
    assert.equal(slim.region ?? null, university.region ?? null);
    assert.equal(slim.type ?? null, university.type ?? null);
    // 카드가 "영상 N"을 그리므로 개수는 같아야 한다.
    assert.equal(slim.resources.length, university.resources.length);
  });

  full.notices.forEach((notice, index) => {
    const slim = list.notices[index];
    assert.equal(slim.id, notice.id);
    assert.equal(slim.university_id, notice.university_id);
    assert.equal(slim.apply_start ?? null, notice.apply_start ?? null);
    assert.equal(slim.apply_end ?? null, notice.apply_end ?? null);
    assert.deepEqual(
      slim.practical_items.map(({ category }) => category),
      notice.practical_items.map(({ category }) => category),
    );
  });
});

test("목록 페이로드에서 상세 전용 값은 빠지고 120KB 아래로 줄어든다", () => {
  assert.ok(list.universities.every((university) => university.tips.length === 0));
  assert.ok(list.universities.every((university) => !("note" in university)));
  assert.ok(
    list.universities.every((university) =>
      university.resources.every(({ title, url }) => title === "" && url === ""),
    ),
  );
  for (const key of ["practical_task", "note", "documents", "preparation", "weights_note", "dress_code", "source_url"]) {
    assert.ok(list.notices.every((notice) => !(key in notice)), key);
  }
  assert.ok(list.notices.every((notice) => notice.results.length === 0));
  assert.ok(list.notices.every((notice) => notice.stages.length === 0));
  assert.ok(
    list.notices.every((notice) =>
      notice.practical_items.every((item) => Object.keys(item).join() === "category"),
    ),
  );

  const serialized = JSON.stringify(list);
  assert.ok(!serialized.includes("undefined"));
  const kb = Buffer.byteLength(serialized) / 1024;
  const fullKb = Buffer.byteLength(JSON.stringify(full)) / 1024;
  assert.ok(kb < 120, `목록 페이로드 ${kb.toFixed(0)}KB (원본 ${fullKb.toFixed(0)}KB)`);
});

// 목록 화면이 원본 대신 이 페이로드로 그려도 결과가 같은지가 이 변경의 전부다.
const FILTER_CASES = [
  EMPTY_FILTERS,
  { ...EMPTY_FILTERS, tracks: ["수시"] },
  { ...EMPTY_FILTERS, disciplines: ["musical"] },
  { ...EMPTY_FILTERS, practicals: ["free_acting"] },
  { ...EMPTY_FILTERS, regions: ["서울"] },
  { ...EMPTY_FILTERS, types: ["college"] },
  { ...EMPTY_FILTERS, noCsatOnly: true },
  { ...EMPTY_FILTERS, openOnly: true },
  { ...EMPTY_FILTERS, query: "중앙" },
  { ...EMPTY_FILTERS, query: "뮤지컬" },
];

const shape = (groups) =>
  groups.map(({ university, notices }) => [university.id, notices.map(({ id }) => id)]);

for (const today of ["2026-09-24", null]) {
  test(`원본과 목록 페이로드의 필터 결과가 같다 (today=${today})`, () => {
    const fullGroups = groupByUniversity(full, today);
    const listGroups = groupByUniversity(list, today);
    assert.deepEqual(shape(listGroups), shape(fullGroups));
    for (const filters of FILTER_CASES) {
      assert.deepEqual(
        shape(filterGroups(listGroups, filters, today)),
        shape(filterGroups(fullGroups, filters, today)),
        JSON.stringify(filters),
      );
    }
  });
}

test("원본과 목록 페이로드의 필터 선택지가 같다", () => {
  assert.deepEqual(availableFacets(list), availableFacets(full));
});

const notice = (fields) => ({
  id: "n",
  university_id: "u",
  designated_works: [],
  essay_questions: [],
  stages: [],
  results: [],
  practical_items: [],
  ...fields,
});

test("요약 줄은 전형·실기 종목·접수 월을 잇는다", () => {
  assert.equal(
    summaryLine([
      notice({ track: "수시", apply_start: "2026-09-08", practical_items: [{ category: "free_acting" }, { category: "assigned_acting" }] }),
      notice({ track: "정시", apply_start: "2026-12-29", practical_items: [{ category: "free_acting" }, { category: "special" }] }),
    ]),
    "수시·정시 · 자유연기·지정연기·특기 · 접수 9·12월",
  );
});

test("요약 줄의 접수 달은 해가 달라도 달 순서로 놓는다", () => {
  assert.equal(
    summaryLine([
      notice({ track: "정시", apply_start: "2025-12-29" }),
      notice({ track: "수시", apply_start: "2026-09-08" }),
    ]),
    "정시·수시 · 접수 9·12월",
  );
});

test("요약 줄은 실기 종목을 넷까지 보이고 나머지는 외 N으로 줄인다", () => {
  assert.equal(
    summaryLine([
      notice({
        track: "수시",
        practical_items: ["free_acting", "assigned_acting", "improv", "song", "dance", "interview"].map((category) => ({ category })),
      }),
    ]),
    "수시 · 자유연기·지정연기·즉흥연기·노래 외 2",
  );
});

test("요약 줄은 빈 조각을 빼고, 다 비면 빈 문자열이다", () => {
  assert.equal(summaryLine([notice({ apply_end: "2026-09-12" })]), "접수 9월");
  assert.equal(summaryLine([notice({})]), "");
  assert.equal(summaryLine([]), "");
});
