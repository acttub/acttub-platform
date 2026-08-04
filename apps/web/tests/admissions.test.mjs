import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { groupByUniversity, isOpen, countdown, matchesQuery } = await import(
  "../src/lib/api/v2/admissions.ts",
);

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
