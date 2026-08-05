import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { fillBlankScene } = await import("../src/lib/api/v2/sessions.ts");

// 화면은 "비워 두셔도 돼요. 빈 칸은 대화에서 물어봐요"라고 안내하지만 서버는 세 칸 모두
// min_length=1을 요구한다. 빈 칸으로 제출하면 압축·업로드가 다 끝난 뒤 마지막 호출에서만
// 422가 나고 화면은 아무 말 없이 멈춘다 — 실사용자 4명이 여기서 이탈했고 한 명은 같은
// 영상을 이틀에 걸쳐 6번 다시 올렸다.

test("빈 칸은 자리표시자로 채워 보낸다", () => {
  const body = fillBlankScene({
    upload_intent_id: "11111111-1111-4111-8111-111111111111",
    situation: "",
    character_context: "",
    goal: "",
  });

  assert.equal(body.situation, ".");
  assert.equal(body.character_context, ".");
  assert.equal(body.goal, ".");
});

test("공백만 있는 칸도 빈 칸으로 본다", () => {
  const body = fillBlankScene({
    upload_intent_id: "11111111-1111-4111-8111-111111111111",
    situation: "   ",
    character_context: "\n\t",
    goal: " ",
  });

  assert.equal(body.situation, ".");
  assert.equal(body.character_context, ".");
  assert.equal(body.goal, ".");
});

test("적어 넣은 값은 그대로 둔다", () => {
  const body = fillBlankScene({
    upload_intent_id: "11111111-1111-4111-8111-111111111111",
    situation: "이별을 통보받은 직후, 카페에서",
    character_context: "담담한 척하는 20대 후반 여성",
    goal: "상대가 마음을 돌려 다시 앉게 만들기",
  });

  assert.equal(body.situation, "이별을 통보받은 직후, 카페에서");
  assert.equal(body.character_context, "담담한 척하는 20대 후반 여성");
  assert.equal(body.goal, "상대가 마음을 돌려 다시 앉게 만들기");
});

test("일부만 비어 있으면 그 칸만 채운다", () => {
  const body = fillBlankScene({
    upload_intent_id: "11111111-1111-4111-8111-111111111111",
    situation: "대표실에서 막말을 들은 직후",
    character_context: "",
    goal: "사과를 받아내기",
  });

  assert.equal(body.situation, "대표실에서 막말을 들은 직후");
  assert.equal(body.character_context, ".");
  assert.equal(body.goal, "사과를 받아내기");
});

test("upload_intent_id는 건드리지 않는다", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  assert.equal(fillBlankScene({ upload_intent_id: id }).upload_intent_id, id);
});

// 자리표시자는 코치가 모호값으로 걸러내는 범위 안에 있어야 한다.
// acting_agent.targeting.is_vague: 공백 제거 후 두 글자 미만이면 모호값 → 프롬프트에서 제외.
test("자리표시자는 코치가 모호값으로 거르는 길이다", () => {
  const placeholder = fillBlankScene({
    upload_intent_id: "33333333-3333-4333-8333-333333333333",
    situation: "",
  }).situation;

  assert.ok(placeholder.replace(/\s+/g, "").length < 2);
});
