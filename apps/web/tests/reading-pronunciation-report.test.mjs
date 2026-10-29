import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { markSegments, markedLineCount, lineIdOf, latestByLine, markWindow, pronunciationSettled } = await import(
  "../src/lib/reading/pronunciation-report.ts"
);

const mark = (index, word, startMs = null, endMs = null) => ({ index, word, lpr: -3, startMs, endMs });

test("어절 순서가 맞으면 그 자리를, 문장부호가 붙어도 같은 어절을 칠한다", () => {
  const segs = markSegments("난 그냥 네가 괜찮은지 궁금했던 거야.", [mark(3, "괜찮은지")]);
  assert.deepEqual(segs, [
    { text: "난 그냥 네가 ", marked: false },
    { text: "괜찮은지", marked: true },
    { text: " 궁금했던 거야.", marked: false },
  ]);
  const tail = markSegments("그런 말 하지 마.", [mark(3, "마")]);
  assert.equal(tail.at(-1).text, "마.");
  assert.equal(tail.at(-1).marked, true);
});

test("어절 순서가 어긋나면 같은 글자의 첫 어절을 칠하고, 없는 말은 칠하지 않는다", () => {
  const segs = markSegments("가자 어서 가자", [mark(0, "어서"), mark(1, "없음")]);
  assert.deepEqual(
    segs.filter((s) => s.marked).map((s) => s.text),
    ["어서"],
  );
});

test("칠한 줄 수와 끝난 상태를 센다", () => {
  assert.equal(markedLineCount({ lines: [{ marks: [mark(0, "a")] }, { marks: [] }] }), 1);
  assert.equal(markedLineCount({}), 0);
  assert.equal(pronunciationSettled("running"), false);
  assert.equal(pronunciationSettled("skipped"), true);
});

test("보고서 줄 번호는 대본 줄 ordinal 로, 글이 다르면 같은 글로 줄 id 를 찾는다", () => {
  const lines = [
    { id: "a", ordinal: 1, text: "첫 줄" },
    { id: "b", ordinal: 2, text: "둘째 줄" },
  ];
  assert.equal(lineIdOf(lines, { lineNo: 2, text: "둘째 줄" }), "b");
  assert.equal(lineIdOf(lines, { lineNo: 9, text: "첫 줄" }), "a");
  assert.equal(lineIdOf(lines, { lineNo: 9, text: "없는 줄" }), null);
});

test("줄마다 마지막 시도 녹음을 고르고, 어절 구간은 앞뒤 150ms 를 더한다", () => {
  const latest = latestByLine([
    { line_id: "a", attempt_no: 1, id: "r1" },
    { line_id: "a", attempt_no: 2, id: "r2" },
    { line_id: "b", attempt_no: 1, id: "r3" },
  ]);
  assert.equal(latest.get("a").id, "r2");
  assert.deepEqual(markWindow({ startMs: 100, endMs: 600 }), { from: 0, to: 0.75 });
  assert.equal(markWindow({ startMs: null, endMs: 600 }), null);
});
