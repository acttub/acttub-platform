// reading.cast — 목소리 저장이 실패한 채 회차를 시작하면 이번 회차는 고른 목소리로 읽고 다음 진입 때 다시 저장한다.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { pendingVoicePresets, retryPendingVoicePresets, saveVoicePreset } = await import("../src/lib/reading/session/voice-presets.ts");
const { createRehearsal, begin, advance } = await import("../src/lib/reading/rehearsal/machine.ts");

beforeEach(() => window.localStorage.clear());

test("reading.cast: 목소리 저장이 실패하면 값을 기기에 남기고, 다음 진입 때 한 요청으로 다시 보내며 성공하면 기록을 지운다", async () => {
  const calls = [];
  let fail = true;
  const deps = {
    update: async (scriptId, body) => {
      calls.push({ scriptId, body });
      if (fail) throw new Error("offline");
      return {};
    },
  };
  assert.equal(await saveVoicePreset("script-1", "c-nina", "M3", deps), false);
  assert.equal(await saveVoicePreset("script-1", "c-tre", null, deps), false);
  assert.deepEqual(pendingVoicePresets("script-1"), { "c-nina": "M3", "c-tre": null });
  assert.deepEqual(calls[0].body, { characters: [{ id: "c-nina", voice_preset: "M3" }] });

  fail = false;
  assert.equal(await retryPendingVoicePresets("script-1", deps), true);
  assert.deepEqual(calls[2].body, { characters: [{ id: "c-nina", voice_preset: "M3" }, { id: "c-tre", voice_preset: null }] });
  assert.deepEqual(pendingVoicePresets("script-1"), {});
  // 남은 것이 없으면 서버에 가지 않는다.
  assert.equal(await retryPendingVoicePresets("script-1", deps), true);
  assert.equal(calls.length, 3);
});

test("reading.cast: 저장에 성공하면 기기에 남긴 값도 지운다", async () => {
  const deps = { update: async () => ({}) };
  window.localStorage.setItem("acttub.reading.pending_voices", JSON.stringify({ "script-1": { "c-nina": "M3" } }));
  assert.equal(await saveVoicePreset("script-1", "c-nina", "F2", deps), true);
  assert.deepEqual(pendingVoicePresets("script-1"), {});
});

const lines = [
  { type: "dialogue", role: "니나", text: "1" },
  { type: "dialogue", role: "트레", text: "2" },
  { type: "dialogue", role: "니나", text: "3" },
  { type: "direction", text: "사이" },
  { type: "dialogue", role: "트레", text: "4" },
  { type: "dialogue", role: "니나", text: "5" },
];

test("reading.cast: 배역 셋인 대본에서 둘을 내 배역으로 하면 둘의 대사가 내 차례이고 남은 하나만 기기가 읽는다", () => {
  const three = [...lines, { type: "dialogue", role: "아르", text: "6" }];
  let s = begin(createRehearsal({ lines: three, myRoles: ["니나", "트레"], start: 0, end: three.length - 1 }));
  const turns = [];
  while (s.status !== "done") {
    turns.push(s.status);
    s = advance(s);
  }
  assert.deepEqual(turns, ["me", "me", "me", "me", "me", "ai"]);
});

test("reading.session: 이어하기는 current_line 부터 시작하되 직전 상대 대사 하나를 먼저 읽는다 (from 인덱스)", () => {
  // 13번 위치(l index 5 = 니나 "5") 에서 이어함: 직전 상대 대사(트레 "4", index 4)부터
  const s = begin(createRehearsal({ lines, myRoles: ["니나"], start: 0, end: lines.length - 1, from: 4 }));
  assert.equal(s.index, 4);
  assert.equal(s.status, "ai");
  const next = advance(s);
  assert.equal(next.index, 5);
  assert.equal(next.status, "me");
  // from 이 구간 밖이면 구간 안으로 조인다
  assert.equal(createRehearsal({ lines, myRoles: ["니나"], start: 0, end: 5, from: 99 }).index, 5);
});
