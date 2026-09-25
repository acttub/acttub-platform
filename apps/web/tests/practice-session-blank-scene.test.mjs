import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";
import "./guest-session-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createPractice } = await import("../src/lib/api/v2/practices.ts");
const { buildPracticeRequest } = await import("../src/features/practice/practice-setup-flow.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Scene Context(상황·인물·목표)는 선택 입력이다(ADR-021, practice.start). 비운 칸은 비운 그대로(빈 문자열)
// 나가야 한다 — 자리표시자를 채워 보내면 그 값이 헤더 제목·연습 목록·접힌 레일 아바타·장면 패널에 그대로
// 뜨고 LLM 프롬프트에도 들어간다.
function captureBody() {
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ id: "p-1", root_id: "p-1", ordinal: 1, stage: "analyzing" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  return sent;
}

const BLOCKAGE = { blockage_kind: "표현", sub_branch: "표정", blockage_detail: null };

test("practice.start: 비운 칸은 비운 그대로(빈 문자열) 실려 나간다", async () => {
  const sent = captureBody();

  await createPractice(buildPracticeRequest("v-1", { situation: "", characterContext: "", goal: "" }, BLOCKAGE), { requestId: "r-1" });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].scene, { situation: "", character: "", goal: "" });
  assert.equal(sent[0].video_id, "v-1");
});

test("practice.start: 일부만 비어 있어도 적은 것과 비운 것이 그대로 가고 앞뒤 공백은 정리한다", async () => {
  const sent = captureBody();

  await createPractice(buildPracticeRequest("v-1", { situation: "  면접 첫 인사 ", characterContext: "", goal: " 담담하게 " }, BLOCKAGE), { requestId: "r-2" });

  assert.deepEqual(sent[0].scene, { situation: "면접 첫 인사", character: "", goal: "담담하게" });
  assert.deepEqual(sent[0].blockage, { category: "표현", detail: "표정", note: null });
});

test("practice.start: 세 칸 어디에도 자리표시자가 섞이지 않는다", () => {
  const body = buildPracticeRequest("v-1", { situation: "   ", characterContext: "\n", goal: "" }, BLOCKAGE);
  for (const v of Object.values(body.scene)) assert.equal(v, "");
});
