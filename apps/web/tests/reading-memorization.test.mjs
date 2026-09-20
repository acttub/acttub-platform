// reading.memorization — 암기 화면의 대상·머리글·진행, 네 모드의 가림 규칙(결정성, 괄호 지문 제외), 외워서 말해보기의 대조 규칙,
// 암기 상태 저장(즉시 전송·오프라인 재시도·같은 상태 재전송 없음).
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { EMPTY_TARGETS_COPY, memorizationHeading, memorizationProgress, memorizationTargets } = await import(
  "../src/lib/reading/memorization/targets.ts"
);
const { maskTokens, MEMO_MODES, renderMasked } = await import("../src/lib/reading/memorization/masking.ts");
const { createMemorizationSync } = await import("../src/lib/reading/memorization/sync.ts");
const { judgeRecital, MAX_RECITAL_MISS } = await import("../src/lib/reading/memorization/recital.ts");

const script = {
  id: "script-1",
  roles: ["니나", "트레"],
  characters: [
    { id: "c-a", name: "니나", voicePreset: null },
    { id: "c-b", name: "트레", voicePreset: null },
  ],
  lines: [
    { type: "direction", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: "셋." },
    { type: "scene", text: "제2막" },
    { type: "dialogue", role: "니나", text: "넷." },
    { type: "dialogue", role: "트레", text: "다섯." },
    { type: "dialogue", role: "니나", text: "여섯." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4", "l-5", "l-6", "l-7"],
};

test("reading.memorization: 내 대사 4줄 중 1줄이 memorized 면 머리가 \"암기하지 못한 대사 3개\" 이고 목록에 3줄(행 없는 줄 포함)이 있다", () => {
  const entries = [{ line_id: "l-1", status: "memorized", updated_at: "" }, { line_id: "l-3", status: "not_yet", updated_at: "" }];
  const t = memorizationTargets(script, ["니나"], entries);
  assert.deepEqual(t.lines.map((l) => l.lineId), ["l-3", "l-5", "l-7"]);
  assert.equal(t.memorizedCount, 1);
  assert.equal(t.total, 4);
  assert.equal(memorizationHeading(["니나"], t.lines.length), "니나 역 · 암기하지 못한 대사 3개");
  assert.equal(memorizationProgress(t), "외운 줄 1 / 내 대사 4");
  // 바로 전 상대 대사를 함께 보여 준다. 첫 대사 앞에는 없다.
  assert.deepEqual(t.lines[0].previousPartner, { role: "트레", text: "둘." });
  assert.equal(t.lines[0].dialogueNo, 3);
  const first = memorizationTargets(script, ["니나"], []).lines[0];
  assert.equal(first.previousPartner, null);
});

test("reading.memorization: 모두 memorized 면 \"못 외운 대사가 없어요\", \"외운 대사도 보기\" 면 memorized 줄도 보인다", () => {
  const all = ["l-1", "l-3", "l-5", "l-7"].map((id) => ({ line_id: id, status: "memorized", updated_at: "" }));
  assert.deepEqual(memorizationTargets(script, ["니나"], all).lines, []);
  assert.equal(EMPTY_TARGETS_COPY, "못 외운 대사가 없어요");
  const shown = memorizationTargets(script, ["니나"], all, { includeMemorized: true });
  assert.deepEqual(shown.lines.map((l) => [l.lineId, l.memorized]), [["l-1", true], ["l-3", true], ["l-5", true], ["l-7", true]]);
});

test("reading.memorization: 완료 화면의 다시 볼 대사로 들어오면 그 줄들만, memorized 여도 열고 표시는 그대로다", () => {
  const entries = [{ line_id: "l-3", status: "memorized", updated_at: "" }];
  const t = memorizationTargets(script, ["니나"], entries, { onlyLineIds: ["l-7", "l-3"] });
  assert.deepEqual(t.lines.map((l) => [l.lineId, l.memorized]), [["l-3", true], ["l-7", false]]);
});

test("reading.memorization: 빈칸 연습은 둘째·넷째… 어절을 가리고 첫 글자 모드는 그 어절의 첫 글자를 남기며, 같은 대사면 언제나 같다", () => {
  assert.deepEqual(MEMO_MODES.map((m) => m.value), ["hidden", "blanks", "initials", "listen"]);
  const text = "너 힘들면 항상 높은 데로 가잖아";
  const a = maskTokens(text, "blanks");
  const b = maskTokens(text, "blanks");
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((t) => [t.text, t.masked]), [["너", false], ["힘들면", true], ["항상", false], ["높은", true], ["데로", false], ["가잖아", true]]);
  assert.deepEqual(maskTokens(text, "initials").map((t) => t.shown), ["너", "힘", "항상", "높", "데로", "가"]);
  assert.deepEqual(maskTokens(text, "hidden").map((t) => t.masked), [true, true, true, true, true, true]);
  // 첫 글자 힌트(가리고·빈칸에서)
  assert.deepEqual(maskTokens(text, "hidden", { hint: true }).map((t) => t.shown), ["너", "힘", "항", "높", "데", "가"]);
  assert.equal(renderMasked(text, "blanks"), "너 ___ 항상 __ 데로 ___");
});

test("reading.memorization: 괄호 지문은 가리지 않고 대조에도 들어가지 않는다", () => {
  const tokens = maskTokens("(웃으며) 그런가. 진짜로", "hidden");
  assert.deepEqual(tokens.map((t) => [t.text, t.masked, t.kind]), [["(웃으며)", false, "direction"], ["그런가.", true, "word"], ["진짜로", true, "word"]]);
  assert.equal(judgeRecital("그런가 진짜로", "(웃으며) 그런가. 진짜로", 0).kind, "pass");
});

test("reading.memorization: 외워서 말해보기 — 유사도 0.72 는 통과, 0.71 은 미달(다시·원문 보기), 같은 줄 2회 미달이면 안내 없이 다음 줄이다", () => {
  assert.equal(MAX_RECITAL_MISS, 2);
  assert.deepEqual(judgeRecital("여기 있을 줄 알았어", "여기 있을 줄 알았어", 0), { kind: "pass" });
  const miss1 = judgeRecital("전혀 다른 말이에요 정말", "여기 있을 줄 알았어", 0);
  assert.deepEqual(miss1, { kind: "retry", misses: 1 });
  assert.deepEqual(judgeRecital("전혀 다른 말이에요 정말", "여기 있을 줄 알았어", 1), { kind: "advance", misses: 2 });
  // 인식 불가·무발화는 미달로 세지 않는다.
  assert.deepEqual(judgeRecital("", "여기 있을 줄 알았어", 0), { kind: "nothing" });
});

test("reading.memorization: \"이 대사 외웠어요\" 는 즉시 보내고, 오프라인이면 기기 값을 먼저 보여 주다 연결되면 서버 값이 기기 값과 같아진다", async () => {
  const sent = [];
  let fail = true;
  const sync = createMemorizationSync({
    initial: [{ line_id: "l-1", status: "memorized", updated_at: "" }],
    send: async (lineId, status) => {
      sent.push([lineId, status]);
      if (fail) throw new Error("offline");
      return { line_id: lineId, status, updated_at: "" };
    },
  });
  assert.equal(sync.status("l-1"), "memorized");
  assert.equal(sync.status("l-3"), null);
  await sync.set("l-3", "memorized");
  assert.equal(sync.status("l-3"), "memorized");
  assert.equal(sync.pending(), 1);
  // 그 사이 마음을 바꿔도 마지막 값만 남는다.
  await sync.set("l-3", "not_yet");
  fail = false;
  await sync.flush();
  assert.deepEqual(sent.at(-1), ["l-3", "not_yet"]);
  assert.equal(sync.pending(), 0);
  assert.equal(sync.status("l-3"), "not_yet");
  // 같은 상태를 다시 눌러도 보내지 않는다.
  const before = sent.length;
  await sync.set("l-3", "not_yet");
  assert.equal(sent.length, before);
  assert.deepEqual(sync.entries().map((e) => [e.line_id, e.status]), [["l-1", "memorized"], ["l-3", "not_yet"]]);
});
