// 입시 두 화면이 답에서 꺼내는 것 — 본문과 "그때의 오늘". 둘은 늘 같이 서고 같이 없다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { answeredAdmissions } = await import(
  "../src/features/admissions/answered.ts"
);

const payload = { universities: [], notices: [], disclaimer: "", updated_at: "" };

test("답이 오기 전에는 본문도 오늘도 없다", () => {
  for (const resource of [
    { state: "idle" },
    { state: "loading" },
    { state: "failed", message: "못 불러왔어요." },
  ]) {
    assert.deepEqual(answeredAdmissions(resource), { payload: null, today: null });
  }
});

test("답이 오면 받은 시각의 오늘을 함께 준다", () => {
  // 사용자가 사는 시간대로 자른다. UTC 로 자르면 한국 오전에 하루가 밀린다.
  const at = new Date(2026, 7, 19, 9, 30).getTime();

  const result = answeredAdmissions({ state: "ready", data: payload, receivedAt: at });

  assert.equal(result.payload, payload);
  assert.equal(result.today, "2026-08-19");
});

test("한 자리 달·날은 0 을 채운다 — 서버가 주는 마감일과 문자열로 견준다", () => {
  const at = new Date(2026, 0, 5, 23, 59).getTime();

  assert.equal(
    answeredAdmissions({ state: "ready", data: payload, receivedAt: at }).today,
    "2026-01-05",
  );
});
