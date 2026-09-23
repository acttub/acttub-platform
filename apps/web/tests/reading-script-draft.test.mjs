// reading.script — 확인 화면(D16)의 초안. 배역 이름 고치기·빼기·더하기와 저장 요청 만들기, 기기 쪽 한도 검사.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { SCRIPT_LIMITS, checkDraft, newDraft, resolveDraft, toCreateRequest, updateDraft } = await import(
  "../src/lib/reading/draft.ts"
);
const { SAMPLE_SCRIPT } = await import("../src/lib/reading/script/sample.ts");

const RAW = `옥상, 밤

(바람 소리.)
윤서: 여기 있을 줄 알았어.
태오: 어떻게 알았어.
제2막
윤서: 다음 거 언제야.
태오: 모레.
행인: 실례합니다.`;

test("reading.script: 저장 요청은 제목·원문·입력 경로와 배역(이름)·줄(순서·종류·배역 번호·글)을 한 번에 싣는다", () => {
  const draft = newDraft(RAW, "paste");
  const { request } = toCreateRequest(draft);

  assert.equal(request.title, "옥상, 밤");
  assert.equal(request.source, "paste");
  assert.equal(request.raw_text, RAW);
  assert.deepEqual(request.characters, [{ name: "윤서" }, { name: "태오" }]);
  assert.deepEqual(request.lines, [
    { ordinal: 1, kind: "direction", character_index: null, text: "바람 소리." },
    { ordinal: 2, kind: "dialogue", character_index: 0, text: "여기 있을 줄 알았어." },
    { ordinal: 3, kind: "dialogue", character_index: 1, text: "어떻게 알았어." },
    { ordinal: 4, kind: "scene", character_index: null, text: "제2막" },
    { ordinal: 5, kind: "dialogue", character_index: 0, text: "다음 거 언제야." },
    { ordinal: 6, kind: "dialogue", character_index: 1, text: "모레." },
    { ordinal: 7, kind: "direction", character_index: null, text: "행인: 실례합니다." },
  ]);
});

test("reading.script: 확인 화면에서 배역 하나를 빼고 저장하면 그 이름의 줄이 지문으로 실린다", () => {
  const draft = updateDraft(newDraft(RAW, "paste"), { exclude: "태오" });
  const { request } = toCreateRequest(draft);

  assert.deepEqual(request.characters, [{ name: "윤서" }]);
  assert.deepEqual(
    request.lines.filter((l) => l.text.startsWith("태오")).map((l) => l.kind),
    ["direction", "direction"],
  );
  assert.equal(request.lines.some((l) => l.kind === "dialogue" && l.character_index === 1), false);
});

test("reading.script: 확인 화면에서 빠진 이름을 더하고 저장하면 그 이름의 줄이 대사로 실린다", () => {
  const draft = updateDraft(newDraft(RAW, "paste"), { addHint: "행인" });
  const { request } = toCreateRequest(draft);

  assert.deepEqual(request.characters, [{ name: "윤서" }, { name: "태오" }, { name: "행인" }]);
  assert.deepEqual(request.lines.at(-1), { ordinal: 7, kind: "dialogue", character_index: 2, text: "실례합니다." });
});

test("reading.script: 뺀 배역은 다시 넣을 수 있고, 배역 칩의 이름을 고치면 배역 이름만 바뀌고 줄의 연결은 그대로다", () => {
  const excluded = updateDraft(newDraft(RAW, "paste"), { exclude: "태오" });
  assert.deepEqual(resolveDraft(excluded).characters.map((c) => [c.name, c.excluded]), [["윤서", false], ["태오", true]]);
  const restored = updateDraft(excluded, { include: "태오" });
  assert.deepEqual(resolveDraft(restored).characters.map((c) => [c.name, c.excluded]), [["윤서", false], ["태오", false]]);

  const renamed = updateDraft(restored, { rename: { from: "태오", to: " 태오 (친구) " } });
  const { request } = toCreateRequest(renamed);
  assert.deepEqual(request.characters, [{ name: "윤서" }, { name: "태오 (친구)" }]);
  assert.deepEqual(
    request.lines.filter((l) => l.kind === "dialogue").map((l) => l.character_index),
    [0, 1, 0, 1],
  );
  // 화면의 칩·대사 수도 고친 이름으로 보인다.
  assert.deepEqual(resolveDraft(renamed).characters.map((c) => [c.name, c.dialogueCount]), [["윤서", 2], ["태오 (친구)", 2]]);
});

test("reading.script: 예시 대본을 불러와 저장하면 입력 경로만 sample 인 보통 대본이다", () => {
  const draft = newDraft(SAMPLE_SCRIPT, "sample");
  const { request } = toCreateRequest(draft);

  assert.equal(request.source, "sample");
  assert.equal(request.title, "옥상, 밤");
  assert.deepEqual(request.characters, [{ name: "윤서" }, { name: "태오" }]);
  assert.equal(request.lines.filter((l) => l.kind === "dialogue").length, 15);
});

test("reading.script: 제목을 못 찾으면 확인 화면의 기본 제목을 쓰고, 제목 칸을 고치면 그 값이 실린다", () => {
  const draft = newDraft("윤서: 하나.\n태오: 둘.\n윤서: 셋.\n태오: 넷.", "typed");
  assert.equal(toCreateRequest(draft).request.title, "제목 없는 대본");
  assert.equal(toCreateRequest(updateDraft(draft, { title: "  연습 대본  " })).request.title, "연습 대본");
});

test("reading.script: 배역이 하나도 안 잡히면 저장하지 않고 이름을 직접 적게 한다 (no_characters)", () => {
  const draft = newDraft("오늘은 아무도 오지 않았다.\n그래도 내일은 오겠지.", "typed");
  assert.deepEqual(resolveDraft(draft).characters, []);
  assert.deepEqual(checkDraft(draft), { ok: false, code: "no_characters" });
  assert.equal(toCreateRequest(draft).request.characters.length, 0);
});

test("reading.script: 이름을 빈 값으로 하거나 같은 대본의 다른 배역과 같게 하면 저장하지 않는다 (invalid_characters)", () => {
  const base = newDraft(RAW, "paste");
  assert.deepEqual(checkDraft(base), { ok: true });
  assert.deepEqual(checkDraft(updateDraft(base, { rename: { from: "태오", to: "   " } })), { ok: false, code: "invalid_characters" });
  assert.deepEqual(checkDraft(updateDraft(base, { rename: { from: "태오", to: " 윤서 " } })), { ok: false, code: "invalid_characters" });
});

test("reading.script: 원문 100,000자·줄 3,000·배역 50 을 넘으면 서버에 보내기 전에 막는다 (script_too_long)", () => {
  assert.deepEqual(SCRIPT_LIMITS, { rawCodePoints: 100_000, lineTextCodePoints: 100_000, lines: 3_000, characters: 50 });

  const twoRoles = "윤서: 하나.\n태오: 둘.\n윤서: 셋.\n태오: 넷.\n";
  // 유니코드 코드 포인트로 센다 — 이모지 하나는 한 글자다.
  const filler = "😀".repeat(100_000 - twoRoles.length);
  assert.deepEqual(checkDraft(newDraft(twoRoles + filler, "paste")), { ok: true });
  assert.deepEqual(checkDraft(newDraft(twoRoles + filler + "😀", "paste")), { ok: false, code: "script_too_long" });

  const manyLines = Array.from({ length: 1_501 }, (_, i) => `윤서: 대사 ${i}\n태오: 대답 ${i}`).join("\n");
  assert.deepEqual(checkDraft(newDraft(manyLines, "paste")), { ok: false, code: "script_too_long" });

  const manyRoles = Array.from({ length: 51 }, (_, i) => `배역${i}: 하나.\n배역${i}: 둘.`).join("\n");
  assert.equal(resolveDraft(newDraft(manyRoles, "paste")).characters.length, 51);
  assert.deepEqual(checkDraft(newDraft(manyRoles, "paste")), { ok: false, code: "script_too_long" });
});
