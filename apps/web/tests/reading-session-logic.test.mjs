// reading.cast·reading.session — 회차의 순수 로직. 프리셋 자동 배정, 전체 구간, 진행 저장(순번·앞으로만·재시도·
// 일시정지 제외 시간), 줄 결과와 완료 표기, 가리기 규칙, 나가기·안내 문구.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { assignPresets, isVoicePreset, PRESET_CYCLE, voicesFor } = await import("../src/lib/reading/session/cast.ts");
const { fullRange, indexOfLine, myDialogueCount, partnerLineBefore, rangeDialogueNos } = await import("../src/lib/reading/session/range.ts");
const { createElapsedClock, createProgressSync } = await import("../src/lib/reading/session/progress.ts");
const { createLineResults, quizSummaryLabel, reviewLines } = await import("../src/lib/reading/session/results.ts");
const { isMasked, MASK_MODES, maskLabel } = await import("../src/lib/reading/session/mask.ts");
const { exitConfirmCopy, guideCopy, NO_SPEECH_NOTICE, RECORD_NOTICE, sessionStatusLabel, resumeLabel } = await import(
  "../src/features/reading/session-copy.ts"
);

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레플레프", "아르카지나", "트리고린"],
  characters: [
    { id: "c-nina", name: "니나", voicePreset: null },
    { id: "c-tre", name: "트레플레프", voicePreset: null },
    { id: "c-ark", name: "아르카지나", voicePreset: null },
    { id: "c-tri", name: "트리고린", voicePreset: null },
  ],
  lines: [
    { type: "scene", text: "제1막" },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "direction", text: "사이." },
    { type: "dialogue", role: "트레플레프", text: "둘." },
    { type: "dialogue", role: "아르카지나", text: "셋." },
    { type: "dialogue", role: "니나", text: "넷." },
    { type: "dialogue", role: "트리고린", text: "다섯." },
    { type: "direction", text: "암전." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4", "l-5", "l-6", "l-7"],
  raw: "",
};

test("reading.cast: 배역 넷 중 하나를 내 배역으로 하면 나머지 셋이 등장 순서로 F1·M1·F2 다", () => {
  assert.deepEqual(PRESET_CYCLE, ["F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5"]);
  const presets = assignPresets(script.characters, ["c-nina"]);
  assert.deepEqual([...presets.entries()], [["c-tre", "F1"], ["c-ark", "M1"], ["c-tri", "F2"]]);
});

test("reading.cast: 내 배역을 바꿔 다시 시작하면 상대역 목록이 달라져 자동 배정도 달라진다", () => {
  const presets = assignPresets(script.characters, ["c-tre"]);
  assert.deepEqual([...presets.entries()], [["c-nina", "F1"], ["c-ark", "M1"], ["c-tri", "F2"]]);
});

test("reading.cast: 배역 \"니나\"를 M3 으로 고정하면 니나는 M3, 나머지는 자동 순환이고 고정한 배역은 순환에서 빠진다", () => {
  const chars = script.characters.map((c) => (c.id === "c-nina" ? { ...c, voicePreset: "M3" } : c));
  const presets = assignPresets(chars, ["c-tri"]);
  assert.deepEqual([...presets.entries()], [["c-nina", "M3"], ["c-tre", "F1"], ["c-ark", "M1"]]);
  // 같은 프리셋을 두 배역에 줄 수 있다.
  const both = chars.map((c) => (c.id === "c-tre" ? { ...c, voicePreset: "M3" } : c));
  assert.deepEqual([...assignPresets(both, ["c-tri"]).entries()], [["c-nina", "M3"], ["c-tre", "M3"], ["c-ark", "F1"]]);
});

test("reading.cast: 기기가 모르는 프리셋 값은 자동으로 다루고, 이름으로 목소리를 찾는 실행 화면용 표도 같은 규칙이다", () => {
  assert.equal(isVoicePreset("M3"), true);
  assert.equal(isVoicePreset("bogus"), false);
  assert.equal(isVoicePreset(null), false);
  const chars = script.characters.map((c) => (c.id === "c-ark" ? { ...c, voicePreset: "bogus" } : c));
  assert.deepEqual([...assignPresets(chars, ["c-nina"]).entries()], [["c-tre", "F1"], ["c-ark", "M1"], ["c-tri", "F2"]]);

  const voices = voicesFor({ ...script, characters: chars }, ["c-nina"]);
  assert.deepEqual(Object.keys(voices), ["트레플레프", "아르카지나", "트리고린"]);
  assert.equal(voices["트레플레프"].preset, "F1");
  assert.equal(typeof voices["트레플레프"].device.pitch, "number");
});

test("reading.session: 웹은 전체 구간으로 시작한다 — 시작·끝은 첫·마지막 대사 줄 id 이고 지문·장면은 구간 안 대사 수에 들지 않는다", () => {
  assert.deepEqual(fullRange(script), { startLineId: "l-1", endLineId: "l-6" });
  assert.deepEqual(rangeDialogueNos(script, "l-1", "l-6"), { start: 1, end: 5 });
  assert.equal(myDialogueCount(script, ["니나"], { startLineId: "l-1", endLineId: "l-6" }), 2);
  assert.equal(myDialogueCount(script, ["니나", "트리고린"], { startLineId: "l-1", endLineId: "l-6" }), 3);
  assert.equal(myDialogueCount(script, ["없는역"], { startLineId: "l-1", endLineId: "l-6" }), 0);
  assert.equal(indexOfLine(script, "l-4"), 4);
  assert.equal(indexOfLine(script, "nope"), -1);
});

test("reading.session: 이어하기는 current_line_id 부터 시작하고 그 줄 직전의 상대 대사 하나를 먼저 읽는다", () => {
  // 니나(l-5) 직전의 상대 대사는 아르카지나(l-4)
  assert.equal(partnerLineBefore(script, indexOfLine(script, "l-5"), ["니나"], 1), 4);
  // 트리고린(l-6) 직전은 니나(l-5, 내 대사) → 그 앞 상대 대사 아르카지나(l-4)
  assert.equal(partnerLineBefore(script, indexOfLine(script, "l-6"), ["니나"], 1), 4);
  // 구간 첫 줄이면 앞이 없다
  assert.equal(partnerLineBefore(script, 1, ["니나"], 1), -1);
});

test("reading.session: 진행 저장은 줄이 바뀔 때마다 순번을 1씩 늘려 보내고, 실패하면 마지막 값을 들고 있다가 다음 저장 때 최신 값을 보낸다", async () => {
  const sent = [];
  let fail = false;
  const sync = createProgressSync({
    send: async (body) => {
      sent.push(body);
      if (fail) throw new Error("offline");
      return { current_line_id: body.current_line_id ?? null, elapsed_seconds: body.elapsed_seconds ?? 0, progress_seq: body.progress_seq, status: "in_progress" };
    },
  });

  await sync.push({ currentLineId: "l-3", elapsedMs: 4_200, lineResults: [] });
  assert.deepEqual(sent[0], { progress_seq: 1, current_line_id: "l-3", elapsed_seconds: 4, line_results: [] });
  assert.equal(sync.pending(), false);

  fail = true;
  await sync.push({ currentLineId: "l-4", elapsedMs: 9_900, lineResults: [] });
  assert.equal(sent[1].progress_seq, 2);
  assert.equal(sync.pending(), true);

  fail = false;
  await sync.push({ currentLineId: "l-5", elapsedMs: 12_000, lineResults: [{ line_id: "l-3", outcome: "passed", misses: 0 }] });
  // 실패한 순번 2 는 버리고 최신 값을 순번 3 으로 보낸다.
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2], { progress_seq: 3, current_line_id: "l-5", elapsed_seconds: 12, line_results: [{ line_id: "l-3", outcome: "passed", misses: 0 }] });
  assert.equal(sync.pending(), false);
});

test("reading.session: 완료 저장은 complete=true 이고 서버가 옛 순번을 무시한 답(현재 값)을 줘도 기기 상태는 되돌아가지 않는다", async () => {
  const sent = [];
  const sync = createProgressSync({
    send: async (body) => {
      sent.push(body);
      // 서버가 더 앞선 값을 들고 있는 척 — 늦게 온 옛 요청을 무시한 답
      return { current_line_id: "l-6", elapsed_seconds: 99, progress_seq: 9, status: "in_progress" };
    },
  });
  await sync.push({ currentLineId: "l-3", elapsedMs: 1_000, lineResults: [] });
  assert.deepEqual(sync.latest(), { currentLineId: "l-3", elapsedMs: 1_000, lineResults: [] });
  await sync.complete({ elapsedMs: 30_500, lineResults: [{ line_id: "l-6", outcome: "skipped", misses: 0 }] });
  assert.deepEqual(sent[1], { progress_seq: 2, current_line_id: null, elapsed_seconds: 30, line_results: [{ line_id: "l-6", outcome: "skipped", misses: 0 }], complete: true });
});

test("reading.session: 회차가 닫혔다는 409 session_closed 는 다시 보내지 않고 닫힘으로 알린다", async () => {
  const { ApiError } = await import("../src/lib/api/v2/errors.ts");
  let calls = 0;
  const sync = createProgressSync({
    send: async () => {
      calls += 1;
      throw new ApiError(409, "session_closed", "session_closed");
    },
  });
  await sync.push({ currentLineId: "l-3", elapsedMs: 1_000, lineResults: [] });
  assert.equal(sync.closed(), true);
  await sync.push({ currentLineId: "l-4", elapsedMs: 2_000, lineResults: [] });
  assert.equal(calls, 1);
});

test("reading.session: 30초 일시정지는 흐른 시간에 들어가지 않는다", () => {
  let now = 1_000;
  const clock = createElapsedClock(() => now);
  clock.start();
  now = 11_000;
  assert.equal(clock.elapsedMs(), 10_000);
  clock.pause();
  now = 41_000;
  assert.equal(clock.elapsedMs(), 10_000);
  clock.resume();
  now = 46_000;
  assert.equal(clock.elapsedMs(), 15_000);
  // 이어하기: 서버에 저장된 누적 시간부터 이어 센다.
  const resumed = createElapsedClock(() => now, 120_000);
  resumed.start();
  now = 47_000;
  assert.equal(resumed.elapsedMs(), 121_000);
});

test("reading.session: 줄 결과는 줄마다 하나이고 마지막 사건이 이긴다 — 2회 미달은 unmatched·misses 2, 첫 미달 뒤 통과는 passed·misses 1, 넘어가기는 skipped", () => {
  const book = createLineResults();
  book.miss("l-1");
  book.miss("l-1");
  assert.deepEqual(book.list(), [{ line_id: "l-1", outcome: "unmatched", misses: 2 }]);
  book.miss("l-3");
  book.pass("l-3");
  book.skip("l-5");
  book.pass("l-6");
  assert.deepEqual(book.list(), [
    { line_id: "l-1", outcome: "unmatched", misses: 2 },
    { line_id: "l-3", outcome: "passed", misses: 1 },
    { line_id: "l-5", outcome: "skipped", misses: 0 },
    { line_id: "l-6", outcome: "passed", misses: 0 },
  ]);
  // 첫 미달은 결과가 아직 아니다(같은 줄에 머문다). 그래도 줄은 기록돼 있어 재시도 횟수를 안다.
  const first = createLineResults();
  assert.equal(first.miss("l-1"), 1);
  assert.deepEqual(first.list(), [{ line_id: "l-1", outcome: "unmatched", misses: 1 }]);
  // 저장된 회차의 결과에서 이어 간다.
  const resumed = createLineResults([{ line_id: "l-1", outcome: "passed", misses: 0 }]);
  assert.equal(resumed.misses("l-1"), 0);
  assert.deepEqual(resumed.list(), [{ line_id: "l-1", outcome: "passed", misses: 0 }]);
});

test("reading.session: 완료 표기 — quiz 는 \"맞춘 줄 K / 시도 N · 아직 안 나온 줄 P\"(K=passed, N=passed+unmatched, P=skipped)이고 다시 볼 대사는 unmatched·skipped 줄이다", () => {
  const results = [
    { line_id: "l-1", outcome: "unmatched", misses: 2 },
    { line_id: "l-3", outcome: "passed", misses: 1 },
    { line_id: "l-5", outcome: "skipped", misses: 0 },
    { line_id: "l-6", outcome: "passed", misses: 0 },
  ];
  assert.equal(quizSummaryLabel(results), "맞춘 줄 2 / 시도 3 · 아직 안 나온 줄 1");
  assert.deepEqual(reviewLines(script, results), [
    { lineId: "l-1", dialogueNo: 1, role: "니나", text: "하나.", outcome: "unmatched" },
    { lineId: "l-5", dialogueNo: 4, role: "니나", text: "넷.", outcome: "skipped" },
  ]);
  assert.deepEqual(reviewLines(script, [{ line_id: "l-6", outcome: "passed", misses: 0 }]), []);
});

test("reading.session: 세 가리기 값은 대사 본문에만 걸리고 quiz 에서는 내 대사가 언제나 가려지며 원문 보기는 그 줄만 푼다", () => {
  assert.deepEqual(MASK_MODES.map((m) => m.value), ["show_all", "hide_mine", "hide_all"]);
  assert.equal(maskLabel("show_all"), "모든 대사 보기");
  assert.equal(maskLabel("hide_mine"), "내 대사만 가리기");
  assert.equal(maskLabel("hide_all"), "모든 대사 가리기");
  const mine = { mine: true, mode: "read" };
  const partner = { mine: false, mode: "read" };
  assert.equal(isMasked("show_all", mine), false);
  assert.equal(isMasked("hide_mine", mine), true);
  assert.equal(isMasked("hide_mine", partner), false);
  assert.equal(isMasked("hide_all", partner), true);
  // quiz: "모든 대사 보기" 여도 내 대사는 가려지고 상대 대사는 보인다.
  assert.equal(isMasked("show_all", { mine: true, mode: "quiz" }), true);
  assert.equal(isMasked("show_all", { mine: false, mode: "quiz" }), false);
  // 원문 보기: 그 줄만
  assert.equal(isMasked("hide_all", { ...mine, revealed: true }), false);
});

test("reading.session: 나가기 확인 문구는 \"지금 나가면 N번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요\" 이고 끝 위치 문구는 없다", () => {
  assert.equal(exitConfirmCopy(12), "지금 나가면 12번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.");
  assert.equal(exitConfirmCopy(0), "지금 나가면 아직 진행하지 않은 걸로 저장돼요. 상세에서 이어서 할 수 있어요.");
  assert.equal(exitConfirmCopy(12).includes("끝 위치"), false);
  assert.equal(NO_SPEECH_NOTICE, "다음을 눌러 넘길 수 있어요");
  assert.equal(RECORD_NOTICE, "내 차례 녹음은 내 계정에 저장돼요");
  assert.equal(resumeLabel({ done: 3, total: 10 }), "이어서 연습 · 3 / 10");
  assert.deepEqual(["in_progress", "completed", "stopped"].map(sessionStatusLabel), ["진행 중", "완료", "중단"]);
});

test("reading.session: 가이드 문구는 녹음 끔·수동 넘김·암기 대조에 맞게 갈리고 \"항상 자동 녹음·자동 다음\" 을 약속하지 않는다", () => {
  const auto = guideCopy({ mode: "read", advance: "silence", record: true });
  assert.equal(auto.some((l) => l.includes("말이 끝나면 자동으로 넘어가요")), true);
  assert.equal(auto.some((l) => l.includes("녹음")), true);
  const manual = guideCopy({ mode: "read", advance: "manual", record: false });
  assert.equal(manual.some((l) => l.includes("자동으로 넘어가요")), false);
  assert.equal(manual.some((l) => l.includes("다음을 눌러")), true);
  assert.equal(manual.some((l) => l.includes("녹음")), false);
  const quiz = guideCopy({ mode: "quiz", advance: "silence", record: false });
  assert.equal(quiz.some((l) => l.includes("가려")), true);
  for (const lines of [auto, manual, quiz]) assert.equal(lines.join(" ").includes("항상"), false);
});
