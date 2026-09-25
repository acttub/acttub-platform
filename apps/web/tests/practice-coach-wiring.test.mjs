// practice.coach — 대화 화면의 배선. 규칙 자체는 practice-coach-api·conversation-view 가 실행으로 지킨다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
const source = read("src/features/workspace/workspace-app.tsx");

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} 를 찾지 못했다`);
  return source.slice(start, end);
}

test("practice.coach: 답은 대화 id·요청 id·revision 을 함께 보낸다", () => {
  const send = block("const send = useCallback", "const restartAfterBlocked");
  assert.match(
    send,
    /replyConversation\(\s*\{ conversationId: coachId, text, revision: revisionRef\.current \},\s*\{ requestId \},/,
  );
  // 같은 차례·같은 본문의 재전송은 같은 요청 id 다 — 메시지가 둘이 되지 않는다.
  assert.match(send, /const requestId = replyRequestIdFor\(coachId, turnIndex, text\)/);
  const keyed = block("const replyRequestIdFor = useCallback", "const send = useCallback");
  assert.match(keyed, /`\$\{conversationId\}:\$\{turnIndex\}:\$\{text\}`/);
});

test("practice.coach: 409 충돌은 입력을 보존하고 최신 대화를 다시 읽는다", () => {
  const send = block("const send = useCallback", "const restartAfterBlocked");
  const conflictAt = send.indexOf("isConversationConflict(reason)");
  assert.notEqual(conflictAt, -1, "충돌 갈래를 찾지 못했다");
  const conflict = send.slice(conflictAt);

  // 쓴 답을 돌려준다 — 다시 보내기만 하면 된다.
  assert.match(conflict, /setAnswer\(text\)/);
  assert.match(conflict, /await getConversation\(coachId\)/);
  assert.match(conflict, /revisionRef\.current = latest\.revision/);
  assert.match(conflict, /setMessages\(conversationLines\(latest\)\)/);
  // 그 사이 대화가 닫혔으면 화면도 닫힌 자리로 간다.
  assert.match(conflict, /latest\.status === "closed"/);
});

test("practice.coach: 닫힌 대화는 새 회차로 가라고 말한다", () => {
  const messages = read("src/lib/api/v2/errors.ts");
  assert.match(messages, /conversation_closed: "이미 마친 대화예요\. 이어서 연습하려면 새 회차를 시작해 주세요\."/);
  const send = block("const send = useCallback", "const restartAfterBlocked");
  assert.match(send, /isClosedCoach\(reason\)/);
  assert.match(send, /setError\(conversationErrorMessage\(reason\)\)/);
  // 닫힌 대화의 노트는 회차 경로로 읽는다. 없는 것도 정상이라 오류로 띄우지 않는다.
  assert.match(send, /load: async \(\) => \(\{ report: await getPracticeNote\(practiceId\) \}\)/);
});

test("practice.coach: 도움 버튼은 입력만 준비하고 답을 보내지 않는다", () => {
  // 버튼만으로 응답 횟수를 쓰지 않는다. 실제 동작은 tests/coach-composer.test.mjs 가 실행으로 지킨다.
  const composer = read("src/features/workspace/coach-composer.tsx");
  const prepare = composer.slice(composer.indexOf("const prepare ="), composer.indexOf("return ("));
  assert.doesNotMatch(prepare, /onSend\(\)/);
  assert.match(composer, /maxLength=\{ACTOR_REPLY_MAX\}/);
});

test("practice.coach: 대화는 회차와 1:1이라 시작 요청 id 가 회차마다 하나다", () => {
  const keyed = block("const conversationRequestId = useCallback", "const trackAnalysis");
  assert.match(keyed, /startRequestIdsRef\.current\.get\(practiceSessionId\)/);
  assert.match(keyed, /startRequestIdsRef\.current\.set\(practiceSessionId, created\)/);
  // 옛 코치 경로(session_id 회전·restart 플래그)는 남아 있지 않다.
  assert.doesNotMatch(source, /startCoach|replyCoach|session_id:/);
});
