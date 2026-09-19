import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { loadAdmissionsStatic, loadUniversityAdmissionsStatic } = await import(
  "../src/features/admissions/admissions-static.ts"
);

test("정적 입시 데이터는 대학과 공고 전량을 읽는다", () => {
  const payload = loadAdmissionsStatic();

  assert.equal(payload.universities.length, 66);
  assert.equal(payload.notices.length, 148);
  assert.ok(payload.updated_at);
});

test("대학 상세는 해당 대학과 공고만 남기고 공통 문구와 수정일을 보존한다", () => {
  const all = loadAdmissionsStatic();
  const payload = loadUniversityAdmissionsStatic("cau");

  assert.ok(payload);
  assert.deepEqual(payload.universities.map(({ id }) => id), ["cau"]);
  assert.ok(payload.notices.length > 0);
  assert.ok(payload.notices.every(({ university_id }) => university_id === "cau"));
  assert.equal(payload.disclaimer, all.disclaimer);
  assert.equal(payload.updated_at, all.updated_at);
});

test("없는 대학 id는 null을 준다", () => {
  assert.equal(loadUniversityAdmissionsStatic("missing-university"), null);
});
