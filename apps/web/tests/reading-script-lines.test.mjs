// reading.script — 서버가 나눈 줄에서 기기가 세는 대사 번호.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { dialogueNumbers } = await import("../src/lib/reading/script/parse.ts");

test("reading.script: 대사 번호는 대사 줄만 1부터 세고 지문·장면은 세지 않는다", () => {
  const lines = [
    { type: "scene", text: "제1막" },
    { type: "direction", text: "바람 소리" },
    { type: "dialogue", role: "지수", text: "하나." },
    { type: "dialogue", role: "민준", text: "둘." },
    { type: "direction", text: "암전" },
    { type: "scene", text: "S#2" },
    { type: "dialogue", role: "지수", text: "셋." },
  ];
  assert.deepEqual(dialogueNumbers(lines), [null, null, 1, 2, null, null, 3]);
});
