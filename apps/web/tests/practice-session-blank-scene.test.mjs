import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createPracticeSession } = await import("../src/lib/api/v2/sessions.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Scene Context(상황·인물·목표)는 선택 입력이다(ADR-021). 비운 칸은 비운 그대로
// 나가야 한다 — 자리표시자를 채워 보내면 그 값이 헤더 제목·연습 목록·접힌 레일
// 아바타·장면 패널에 그대로 뜨고 LLM 프롬프트에도 들어간다.
function captureBody() {
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ session_id: "s-1", status: "analyzed" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  return sent;
}

test("비운 칸은 비운 그대로 실려 나간다", async () => {
  const sent = captureBody();

  await createPracticeSession({
    upload_intent_id: "11111111-1111-4111-8111-111111111111",
    situation: "",
    character_context: "",
    goal: "",
    blockage_kind: "표현",
    sub_branch: "표정",
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].situation, "");
  assert.equal(sent[0].character_context, "");
  assert.equal(sent[0].goal, "");
});

test("일부만 비어 있어도 적은 것과 비운 것이 그대로 간다", async () => {
  const sent = captureBody();

  await createPracticeSession({
    upload_intent_id: "22222222-2222-4222-8222-222222222222",
    situation: "대표실에서 막말을 들은 직후",
    character_context: "",
    goal: "사과를 받아내기",
    blockage_kind: "분석",
    sub_branch: "대사 분석",
  });

  assert.equal(sent[0].situation, "대표실에서 막말을 들은 직후");
  assert.equal(sent[0].character_context, "");
  assert.equal(sent[0].goal, "사과를 받아내기");
});

test("세 칸 어디에도 자리표시자가 섞이지 않는다", async () => {
  const sent = captureBody();

  await createPracticeSession({
    upload_intent_id: "33333333-3333-4333-8333-333333333333",
    situation: "",
    character_context: "",
    goal: "",
    blockage_kind: "표현",
    sub_branch: "그 외",
  });

  // 옛 우회 장치가 채우던 값. 두 글자 미만이라 코치가 모호값으로 걸러 주기는
  // 했지만 화면 일곱 군데는 그것을 그대로 보여 줬다.
  for (const field of ["situation", "character_context", "goal"]) {
    assert.notEqual(sent[0][field], ".");
  }
});
