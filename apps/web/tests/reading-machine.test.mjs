// reading.session 진행 상태머신 — 화면에 보일 줄 묶음과, 상태가 맞지 않을 때 그대로 두는 경우.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { advance, begin, createRehearsal, pause, resume, window } = await import("../src/lib/reading/rehearsal/machine.ts");

const lines = [
  { type: "scene", text: "1막 1장" },
  { type: "dialogue", role: "니나", text: "하나." },
  { type: "direction", text: "문이 열린다." },
  { type: "scene", text: "2장" },
  { type: "direction", text: "밤." },
  { type: "dialogue", role: "트레플레프", text: "둘." },
  { type: "direction", text: "퇴장." },
];
const cfg = { lines, myRoles: ["니나"], start: 0, end: lines.length - 1 };

test("reading.machine: 현재 대사 바로 위의 지문·장면 줄을 원래 순서대로 모으고 앞 대사에서 멈춘다", () => {
  const s = advance(begin(createRehearsal(cfg)));
  assert.equal(s.index, 5);
  assert.deepEqual(window(s).leadingDirections, ["문이 열린다.", "2장", "밤."]);
  assert.equal(window(s).current.text, "둘.");
});

test("reading.machine: 첫 대사 앞의 장면 줄도 현재 줄 위에 보인다", () => {
  const s = createRehearsal(cfg);
  assert.deepEqual(window(s).leadingDirections, ["1막 1장"]);
  assert.equal(window(s).next.text, "둘.");
});

test("reading.machine: 마지막 대사에서는 다음 대사가 없고, 끝나면 현재 대사도 없다", () => {
  const last = advance(begin(createRehearsal(cfg)));
  assert.equal(window(last).next, null);
  const done = advance(last);
  assert.equal(done.status, "done");
  assert.equal(window(done).current, null);
  assert.equal(window(done).next, null);
  assert.deepEqual(
    window(done).past.map((l) => l.text),
    ["1막 1장", "하나.", "문이 열린다.", "2장", "밤."],
  );
});

test("reading.machine: 이미 시작했거나 일시정지한 회차에 begin 을 다시 불러도 상태가 바뀌지 않는다", () => {
  const started = begin(createRehearsal(cfg));
  assert.equal(started.status, "me");
  assert.equal(begin(started), started);
  const paused = pause(started);
  assert.equal(begin(paused), paused);
});

test("reading.machine: 일시정지가 아닌 회차에 resume 을 불러도 상태가 바뀌지 않는다", () => {
  const started = begin(createRehearsal(cfg));
  assert.equal(resume(started), started);
  const odd = { ...started, status: "paused", resumeTo: null };
  assert.equal(resume(odd), odd);
});

test("reading.machine: 이어하기 위치가 구간 밖이면 구간 안으로 당긴다", () => {
  assert.equal(createRehearsal({ ...cfg, from: 99 }).status, "done");
  assert.equal(createRehearsal({ ...cfg, start: -3, from: -1 }).index, 1);
  assert.equal(createRehearsal({ ...cfg, from: 2 }).index, 5);
});
