// reading.cast·reading.session — 배역 화면(D17)의 시작 규칙: 기본 선택, 하나뿐인 배역, 모든 배역 선택, 시작 요청 본문.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { buildSessionRequest, checkStart, defaultMyCharacterIds, hasPartnerLines, rolesOf, START_BUTTON } = await import(
  "../src/features/reading/session-start.ts"
);

const script = {
  id: "script-1",
  characters: [
    { id: "c-a", name: "니나", voicePreset: null },
    { id: "c-b", name: "트레플레프", voicePreset: null },
    { id: "c-c", name: "아르카지나", voicePreset: null },
  ],
  lines: [
    { type: "direction", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "dialogue", role: "트레플레프", text: "둘." },
    { type: "dialogue", role: "아르카지나", text: "셋." },
    { type: "dialogue", role: "니나", text: "넷." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4"],
  openSessionId: null,
  lastSession: null,
};

test("reading.cast: 첫 회차의 배역 화면은 아무것도 선택돼 있지 않고, 두 번째 회차는 첫 회차의 내 배역이 선택돼 있다", () => {
  assert.deepEqual(defaultMyCharacterIds(script), []);
  const withLast = { ...script, lastSession: { id: "s-1", status: "completed", myCharacterIds: ["c-b", "c-zzz"] } };
  assert.deepEqual(defaultMyCharacterIds(withLast), ["c-b"]);
});

test("reading.cast: 배역 하나인 대본은 그 배역이 내 배역이 되고 확인만 받는다", () => {
  const solo = { ...script, characters: [script.characters[0]] };
  assert.deepEqual(defaultMyCharacterIds(solo), ["c-a"]);
});

test("reading.cast: 모든 배역을 고르면 기기가 읽는 줄이 없어 목소리 준비를 기다리지 않고 시작한다", () => {
  assert.equal(hasPartnerLines(script, ["c-a", "c-b", "c-c"]), false);
  assert.equal(hasPartnerLines(script, ["c-a"]), true);
  assert.deepEqual(checkStart(script, ["c-a", "c-b", "c-c"], false), { ok: true });
  assert.deepEqual(checkStart(script, ["c-a"], false), { ok: false, reason: "voice_not_ready" });
  assert.deepEqual(checkStart(script, ["c-a"], true), { ok: true });
});

test("reading.cast: 배역 0개로는 시작하지 않고, 구간 안에 내 대사가 없는 배역만 고르면 empty_range 다", () => {
  assert.deepEqual(checkStart(script, [], true), { ok: false, reason: "no_characters" });
  const silent = { ...script, characters: [...script.characters, { id: "c-d", name: "침묵", voicePreset: null }] };
  assert.deepEqual(checkStart(silent, ["c-d"], true), { ok: false, reason: "empty_range" });
});

test("reading.session: 시작 요청은 내 배역·방식·전체 구간(첫·마지막 대사 줄 id)·넘김·녹음을 싣는다", () => {
  assert.deepEqual(rolesOf(script, ["c-c", "c-a"]), ["니나", "아르카지나"]);
  assert.deepEqual(buildSessionRequest(script, { myCharacterIds: ["c-a", "c-c"], mode: "quiz", advance: "manual", record: false, mask: "hide_all" }), {
    my_character_ids: ["c-a", "c-c"],
    mode: "quiz",
    start_line_id: "l-1",
    end_line_id: "l-4",
    advance: "manual",
    record: false,
  });
  assert.equal(buildSessionRequest({ lines: [{ type: "direction", text: "x" }], lineIds: ["l-0"] }, { myCharacterIds: ["c-a"], mode: "read", advance: "silence", record: true, mask: "show_all" }), null);
  assert.equal(START_BUTTON(2), "선택한 2개 배역으로 연습하기");
});
