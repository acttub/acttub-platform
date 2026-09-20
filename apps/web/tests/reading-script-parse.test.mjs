// reading.script — 파서의 장면 줄·대사 번호·영어 무대어(앱과 같은 규칙)·등장인물 목록 밖 이름 규칙.
// 요구사항 「검증 방법」의 파서 항목 하나가 여기 테스트 하나다. 형식별 고정 결과는
// tests/reading-script-fixtures.test.mjs 가 공통 검증 자료로 본다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { countByKind, dialogueNumbers, parseScript, detectRoles } = await import(
  "../src/lib/reading/script/parse.ts"
);

const kinds = (lines) => lines.map((l) => l.type);

test("reading.script: \"제1막\"과 \"S#2\" 줄이 있는 대본에서 그 두 줄은 kind가 scene이고 배역이 없다", () => {
  const s = parseScript(`제1막

지수: 오래 기다렸어?
민준: 아니, 나도 방금 왔어.

S#2

지수: 다행이다.
민준: 응.`);
  assert.deepEqual(s.roles, ["지수", "민준"]);
  assert.deepEqual(kinds(s.lines), ["scene", "dialogue", "dialogue", "scene", "dialogue", "dialogue"]);
  assert.deepEqual(s.lines[0], { type: "scene", text: "제1막" });
  assert.deepEqual(s.lines[3], { type: "scene", text: "S#2" });
  assert.equal("role" in s.lines[0], false);
});

test("reading.script: 막·장 머리 줄의 여러 표기(1막, 제 2 장, 1막 2장, [막] 3막, 프롤로그·에필로그)가 장면이 된다", () => {
  const s = parseScript(`프롤로그
지수: 안녕.
민준: 안녕.
1막
지수: 하나.
제 2 장
민준: 둘.
1막 2장
지수: 셋.
[막] 3막
민준: 넷.
에필로그
지수: 끝.`);
  const scenes = s.lines.filter((l) => l.type === "scene").map((l) => l.text);
  assert.deepEqual(scenes, ["프롤로그", "1막", "제 2 장", "1막 2장", "3막", "에필로그"]);
  assert.equal(s.lines.filter((l) => l.type === "dialogue").length, 7);
});

test("reading.script: 대사 바로 뒤에 온 장면 줄은 앞 대사에 이어 붙지 않는다", () => {
  const s = parseScript(`지수: 오래 기다렸어?
민준: 아니.
제2막
지수: 다행이다.
민준: 응.`);
  assert.equal(s.lines[1].text, "아니.");
  assert.deepEqual(s.lines[2], { type: "scene", text: "제2막" });
});

test("reading.script: 장면 줄 뒤에 설명이 붙은 표기(S#3. 카페 안, 낮 / 1장 - 거실)도 장면이고 그 글이 장면 이름이다", () => {
  const s = parseScript(`S#3. 카페 안, 낮
지수: 여기야.
민준: 응.
1장 - 거실
지수: 왔어?
민준: 응.`);
  const scenes = s.lines.filter((l) => l.type === "scene").map((l) => l.text);
  assert.deepEqual(scenes, ["S#3. 카페 안, 낮", "1장 - 거실"]);
});

test("reading.script: 영어 막·장(Act 1, SCENE 2, ACT I, SCENE 3)도 장면이고 화자 자리의 영어 무대어(PAUSE, BEAT)는 배역이 아니다 — 앱 파서와 같은 규칙", () => {
  const s = parseScript(`Act 1

Anna: Did you wait long?
Ben: No, I just got here.
PAUSE: (a long silence)
SCENE 2
Anna: Good.
BEAT
Ben: Yes.
ACT I, SCENE 3
Anna: Then let's go.
Ben: Sure.`);
  assert.deepEqual(s.roles, ["Anna", "Ben"]);
  const scenes = s.lines.filter((l) => l.type === "scene").map((l) => l.text);
  assert.deepEqual(scenes, ["Act 1", "SCENE 2", "ACT I, SCENE 3"]);
  assert.equal(s.lines.some((l) => l.type === "dialogue" && (l.role === "PAUSE" || l.role === "BEAT")), false);
  assert.deepEqual(detectRoles("PAUSE: ...\nBEAT: ...\nAnna: hi\nBen: hi\nAnna: yo\nBen: yo"), ["Anna", "Ben"]);
});

test("reading.script: 대사 번호는 대사 줄만 1부터 세고 지문·장면은 세지 않는다", () => {
  const s = parseScript(`제1막
(바람 소리)
지수: 하나.
민준: 둘.
[암전]
S#2
지수: 셋.
민준: 넷.`);
  assert.deepEqual(kinds(s.lines), ["scene", "direction", "dialogue", "dialogue", "direction", "scene", "dialogue", "dialogue"]);
  assert.deepEqual(dialogueNumbers(s.lines), [null, null, 1, 2, null, null, 3, 4]);
  assert.deepEqual(countByKind(s.lines), { dialogue: 4, direction: 2, scene: 2 });
});

test("reading.script: 첫 줄이 30자 이하이고 다음 줄이 비어 있으면 제목이고, 막 표시나 31자 줄은 제목이 아니다", () => {
  const body = "지수: 하나.\n민준: 둘.\n지수: 셋.\n민준: 넷.";
  const titled = parseScript(`옥상, 밤\n\n${body}`);
  assert.equal(titled.title, "옥상, 밤");
  assert.equal(titled.lines[0].type, "dialogue");

  const act = parseScript(`제1막\n\n${body}`);
  assert.equal(act.title, undefined);
  assert.equal(act.lines[0].type, "scene");

  const long = "가".repeat(31);
  const tooLong = parseScript(`${long}\n\n${body}`);
  assert.equal(tooLong.title, undefined);
  assert.deepEqual(tooLong.lines[0], { type: "direction", text: long });

  const noBlank = parseScript(`옥상, 밤\n${body}`);
  assert.equal(noBlank.title, undefined);
});

/** 등장인물 목록이 있고 목록 밖 이름이 `offLines`줄, 목록 배역 둘이 합쳐 `castLines`줄인 대본 */
function scriptWithOffCastName(offLines, castLines) {
  const out = ["나오는 사람들", "지수", "민준", ""];
  let off = 0;
  for (let i = 0; i < castLines; i++) {
    out.push(`${i % 2 === 0 ? "지수" : "민준"}: 대사 ${i}`);
    if (off < offLines && i % 3 === 2) {
      out.push(`행인: 지나가는 말 ${off}`);
      off++;
    }
  }
  while (off < offLines) out.push(`행인: 지나가는 말 ${off++}`);
  return out.join("\n");
}

test("reading.script: 등장인물 목록 밖 이름이 7줄이면 배역이 아니고, 8줄이지만 전체 발화의 0.9%면 배역이 아니며, 8줄이고 1%면 배역이다", () => {
  const seven = parseScript(scriptWithOffCastName(7, 100));
  assert.deepEqual(seven.roles, ["지수", "민준"]);
  assert.equal(seven.lines.some((l) => l.type === "direction" && l.text.startsWith("행인")), true);

  // 8 / (8 + 881) ≈ 0.9%
  const eightBelow = parseScript(scriptWithOffCastName(8, 881));
  assert.deepEqual(eightBelow.roles, ["지수", "민준"]);

  // 8 / (8 + 792) = 1.0%
  const eightAt = parseScript(scriptWithOffCastName(8, 792));
  assert.deepEqual(eightAt.roles, ["지수", "민준", "행인"]);
  assert.equal(eightAt.lines.filter((l) => l.type === "dialogue" && l.role === "행인").length, 8);
});
