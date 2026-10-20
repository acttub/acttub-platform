// reading.session — 단계 경로와 구간 계산의 가장자리. 깨진 대본 주소, 구간이 없거나 줄을 못 찾는 경우.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { redirectFor, scriptIdFromPath } = await import("../src/lib/reading/step.ts");
const { fullRange, indexOfLine, rangeIndexes } = await import("../src/lib/reading/session/range.ts");

test("reading.script: 대본 주소의 id 가 깨진 퍼센트 인코딩이면 대본 id 가 없다", () => {
  assert.equal(scriptIdFromPath("/reading/scripts/%E0%A4%A"), null);
  assert.equal(scriptIdFromPath("/reading/scripts/%EB%B4%84/"), "봄");
});

test("reading.session: 대본·회차가 다 있으면 실행 화면에 머물고, 대본이 있으면 배역 화면에 머문다", () => {
  assert.equal(redirectFor("run", { hasScript: true, hasSession: true, hasStats: false }), null);
  assert.equal(redirectFor("setup", { hasScript: true, hasSession: false, hasStats: false }), null);
});

const script = {
  lines: [
    { type: "scene", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "direction", text: "웃는다." },
  ],
  lineIds: ["l-0", "l-1", "l-2"],
};

test("reading.session: 대사가 하나도 없는 대본은 구간이 없다", () => {
  assert.equal(fullRange({ lines: [script.lines[0]], lineIds: ["l-0"] }), null);
});

test("reading.session: 줄 id 가 없거나 못 찾으면 위치가 없고, 구간이 없거나 못 찾으면 대본 전체다", () => {
  assert.equal(indexOfLine(script, null), -1);
  assert.equal(indexOfLine(script, "l-9"), -1);
  assert.deepEqual(rangeIndexes(script, null), { start: 0, end: 2 });
  assert.deepEqual(rangeIndexes(script, { startLineId: "l-9", endLineId: "l-8" }), { start: 0, end: 2 });
  assert.deepEqual(rangeIndexes(script, { startLineId: "l-1", endLineId: "l-1" }), { start: 1, end: 1 });
});
