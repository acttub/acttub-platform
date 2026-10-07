import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  splitByYear,
  noticeStage,
  resultHistory,
  tipsByYear,
  universityDigest,
  yearResultRows,
  competitionRatio,
} = await import("../src/features/admissions/by-year.ts");

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

test("공고를 학년도 내림차순으로 묶고, 최신보다 옛 학년도는 대신 보여주는 공고로 표시한다", () => {
  const sections = splitByYear([
    notice({ id: "a", admission_year: 2027, track: "수시" }),
    notice({ id: "b", admission_year: 2026, track: "정시" }),
    notice({ id: "c", admission_year: 2027, track: "정시" }),
    notice({ id: "d", admission_year: null }),
  ]);
  assert.deepEqual(
    sections.map(({ year, standIn, notices }) => [year, standIn, notices.map(({ id }) => id)]),
    [
      [2027, false, ["a", "c"]],
      [2026, true, ["b"]],
      [null, false, ["d"]],
    ],
  );
});

test("한 학년도 안에서는 수시를 정시보다 먼저 놓는다", () => {
  const [section] = splitByYear([
    notice({ id: "j", admission_year: 2027, track: "정시" }),
    notice({ id: "s", admission_year: 2027, track: "수시" }),
  ]);
  assert.deepEqual(section.notices.map(({ id }) => id), ["s", "j"]);
});

test("다른 대학 기준 최신 학년도를 주면 그보다 옛 공고만 대신 보여주는 공고다", () => {
  const sections = splitByYear([notice({ id: "b", admission_year: 2026 })], 2027);
  assert.equal(sections[0].standIn, true);
  assert.equal(splitByYear([notice({ id: "a", admission_year: 2027 })], 2027)[0].standIn, false);
});

const sejong = notice({
  apply_start: "2026-09-08",
  apply_end: "2026-09-11",
  practical_date: "2026-09-29",
  practical_date_end: "2026-10-31",
  announce_date: "2026-11-06",
});

test("오늘 날짜로 전형이 어디쯤인지 고른다", () => {
  assert.equal(noticeStage(sejong, "2026-09-01")?.label, "접수 예정");
  assert.equal(noticeStage(sejong, "2026-09-08")?.label, "접수 중");
  assert.equal(noticeStage(sejong, "2026-09-11")?.label, "접수 중");
  assert.equal(noticeStage(sejong, "2026-09-20")?.label, "실기 예정");
  assert.equal(noticeStage(sejong, "2026-10-02")?.label, "실기 진행 중");
  assert.equal(noticeStage(sejong, "2026-10-31")?.label, "실기 진행 중");
  assert.equal(noticeStage(sejong, "2026-11-03")?.label, "발표 예정");
  assert.equal(noticeStage(sejong, "2026-11-07")?.label, "전형 종료");
});

test("날짜를 모르면 아는 데까지만 말하고, 오늘을 모르면 아무 말도 안 한다", () => {
  assert.equal(noticeStage(notice({ apply_end: "2026-09-11" }), "2026-10-02")?.label, "접수 마감");
  assert.equal(noticeStage(notice({}), "2026-10-02"), null);
  assert.equal(noticeStage(sejong, null), null);
  assert.equal(
    noticeStage(notice({ apply_end: "2026-09-11", practical_date: "2026-10-10" }), "2026-10-02")?.label,
    "실기 예정",
  );
});

test("입시결과는 결과가 있는 공고만, 학년도 내림차순으로 모은다", () => {
  const history = resultHistory([
    notice({ id: "a", results: [{ year: 2025, competition_rate: "10:1" }, { year: 2026, competition_rate: "12:1" }] }),
    notice({ id: "b", results: [] }),
  ]);
  assert.deepEqual(
    history.map(({ notice: { id }, rows }) => [id, rows.map(({ year }) => year)]),
    [["a", [2026, 2025]]],
  );
});

test("경쟁률 표기에서 앞 숫자를 읽는다", () => {
  assert.equal(competitionRatio("82.91:1"), 82.91);
  assert.equal(competitionRatio("1,824 : 22"), null);
  assert.equal(competitionRatio("12 : 1"), 12);
  assert.equal(competitionRatio(null), null);
});

test("학년도별 결과 줄은 그해 결과가 있는 공고만, 경쟁률 높은 순으로 세운다", () => {
  const groups = [
    {
      university: { id: "x", name: "엑스대" },
      notices: [notice({ id: "x1", results: [{ year: 2026, competition_rate: "20:1" }, { year: 2025, competition_rate: "30:1" }] })],
    },
    {
      university: { id: "y", name: "와이대" },
      notices: [
        notice({ id: "y1", results: [{ year: 2026, competition_rate: "50.5:1" }] }),
        notice({ id: "y2", results: [{ year: 2026, quota: 3, competition_rate: null }] }),
      ],
    },
  ];
  assert.deepEqual(
    yearResultRows(groups, 2026).map(({ notice: { id } }) => id),
    ["y1", "x1", "y2"],
  );
  assert.deepEqual(yearResultRows(groups, 2025).map(({ notice: { id } }) => id), ["x1"]);
});

test("후기를 응시 학년도별로 묶고, 연도를 모르는 후기는 맨 뒤에 둔다", () => {
  const sections = tipsByYear([
    { text: "a", category: "day_of", source_type: "personal", year: 2025 },
    { text: "b", category: "practice", source_type: "personal" },
    { text: "c", category: "practice", source_type: "personal", year: 2026 },
    { text: "d", category: "day_of", source_type: "personal", year: 2026 },
  ]);
  assert.deepEqual(
    sections.map(({ year, label, groups }) => [year, label, groups.flatMap(({ items }) => items.map(({ text }) => text))]),
    [
      [2026, "2026학년도 응시 후기", ["d", "c"]],
      [2025, "2025학년도 응시 후기", ["a"]],
      [null, "응시 연도를 밝히지 않은 후기", ["b"]],
    ],
  );
});

test("한눈에 보기는 데이터로만 문장을 만든다", () => {
  const lines = universityDigest(
    [
      notice({
        admission_year: 2027,
        track: "수시",
        department: "연극학과",
        practical_items: [{ category: "free_acting" }, { category: "special" }],
        results: [{ year: 2026, competition_rate: "82.91:1" }],
      }),
      notice({ admission_year: 2027, track: "수시", practical_items: [{ category: "free_acting" }] }),
      notice({ admission_year: 2026, track: "정시", department: "연극학과", results: [{ year: 2025, competition_rate: "9:1" }] }),
    ],
    [{ text: "t", category: "etc", source_type: "personal", year: 2026 }],
    2027,
  );
  assert.deepEqual(lines, [
    "2027학년도에는 수시 2개 전형으로 뽑아요.",
    "정시는 2027학년도 요강이 아직 나오지 않아 2026학년도 기준으로 적었어요.",
    "실기는 자유연기·특기를 봐요.",
    "2026학년도 연극학과 수시 경쟁률은 82.91:1이었어요.",
    "먼저 응시한 사람들의 후기 1건을 학년도별로 묶었어요.",
  ]);
});

test("한 공고에 같은 해 결과가 여럿이면 경쟁률을 범위 한 줄로 합친다", () => {
  const lines = universityDigest(
    [
      notice({
        admission_year: 2027,
        track: "수시",
        department: "연극전공",
        results: [
          { year: 2026, competition_rate: "121.5:1" },
          { year: 2026, competition_rate: "49.3:1" },
        ],
      }),
    ],
    [],
    2027,
  );
  assert.ok(lines.includes("2026학년도 연극전공 수시 경쟁률은 49.3:1~121.5:1이었어요."));
  assert.equal(lines.filter((line) => line.includes("경쟁률")).length, 1);
});

test("한눈에 보기는 모르는 조각을 빼고, 공고가 없으면 빈 배열이다", () => {
  assert.deepEqual(universityDigest([], [], 2027), []);
  assert.deepEqual(universityDigest([notice({ admission_year: 2027, track: "정시" })], [], 2027), [
    "2027학년도에는 정시 1개 전형으로 뽑아요.",
  ]);
});
