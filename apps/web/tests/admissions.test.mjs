import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { groupByUniversity, isOpen } = await import("../src/lib/api/v2/admissions.ts");

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
