import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const source = readFileSync(
  path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
  "utf8",
);

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} 를 찾지 못했다`);
  return source.slice(start, end);
}

test("대화가 끝나도 화면을 노트로 자동 전환하지 않는다", () => {
  const pushAi = block("const pushAi = useCallback", "const openNote = useCallback");
  assert.match(pushAi, /setReport\(completed\)/);
  assert.doesNotMatch(pushAi, /setMode\("note"\)/);
});

test("노트 전환과 결과 조회 집계는 배우가 누를 때만 일어난다", () => {
  const openNote = block("const openNote = useCallback", "const restoreCoach = useCallback");
  assert.match(openNote, /setMode\("note"\)/);
  assert.match(openNote, /countStepOnce\(activeIdRef\.current, "result"\)/);
});

test("첫 응답이 곧바로 끝나도 화면을 노트로 자동 전환하지 않는다", () => {
  const restoreCoach = block("const restoreCoach = useCallback", "const coordinatorFor = useCallback");
  assert.match(restoreCoach, /setReport\(completed\)/);
  assert.doesNotMatch(restoreCoach, /setMode\("note"\)/);
});

test("대화가 끝나면 입력창 대신 정리보기 버튼이 나온다", () => {
  const chatPanel = block("function ChatPanel({", "function Bubble({");
  assert.match(chatPanel, /noteReady \? "지금까지 이야기한 걸 정리해 뒀어요\." : "정리하고 있어요…"/);
  assert.match(chatPanel, /onClick=\{onOpenNote\}/);
  assert.match(chatPanel, /disabled=\{!noteReady\}/);
  assert.match(chatPanel, /정리보기/);
});

test("대화가 끝난 화면은 아직 질문 중이라고 말하지 않는다", () => {
  const chatPanel = block("function ChatPanel({", "function Bubble({");
  assert.match(chatPanel, /done \? "이번 대화는 여기까지예요" : "현재 장면을 바탕으로 질문하고 있어요"/);

  const statusChip = block("function StatusChip({", "/* ── 잡다한 것");
  assert.match(statusChip, /mode === "chat" && done \? \["대화 마침"/);
});
