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
  // 코치 응답은 대화 자리의 전이만 낸다. 노트 화면으로 넘기는 전이를 여기서 내면
  // 마지막 인사를 읽기도 전에 화면이 넘어간다.
  // 코치 세션 id 는 응답이 준 것을 그대로 싣는다 — 화면이 그것으로 답을 보낸다.
  assert.match(
    pushAi,
    /dispatch\(\{\s*type: "coachTurnReceived",\s*coachId: turn\.session_id,/,
  );
  assert.doesNotMatch(pushAi, /noteOpened|noteLoaded/);
  // 목록 새로고침은 노트가 딸려 온 턴에서만 한다.
  assert.match(pushAi, /if \(completed\) void refreshList\(\);/);
});

test("노트 전환과 결과 조회 집계는 배우가 누를 때만 일어난다", () => {
  const openNote = block("const openNote = useCallback", "const restoreCoach = useCallback");
  assert.match(openNote, /dispatch\(\{ type: "noteOpened" \}\)/);
  // 집계는 화면이 든 노트를 읽고, 그것이 있을 때만 나간다. 노트 없이 세면 그 자리에
  // 서지도 못한 사람이 결과를 봤다고 기록된다.
  assert.match(openNote, /const opened = currentReport\(screen\);/);
  assert.match(
    openNote,
    /if \(opened && countStepOnce\(activeIdRef\.current, "result"\)\)/,
  );
  assert.match(openNote, /opened\.report_type/);
});

test("노트 화면은 화면이 든 노트를 그대로 받는다", () => {
  // 화면 밖 state 에서 따로 끌어오면 화면이 든 것과 어긋날 수 있다.
  const notePanel = block("<NotePanel", "<ChatPanel");
  assert.match(notePanel, /report=\{body\.report\}/);
});

test("대화 입력이 열리는지는 화면이 정한 코치 유무를 따른다", () => {
  const chatPanel = block("<ChatPanel", "onOpenNote={openNote}");
  assert.match(
    chatPanel,
    /inputEnabled=\{isCoachInputEnabled\(\{\s*coachReady: body\.coachReady,/,
  );
});

test("첫 응답이 곧바로 끝나도 화면을 노트로 자동 전환하지 않는다", () => {
  const restoreCoach = block("const restoreCoach = useCallback", "const coordinatorFor = useCallback");
  assert.match(
    restoreCoach,
    /dispatch\(\{\s*type: "coachTurnReceived",\s*coachId: turn\.session_id,[\s\S]{0,120}report: completed,/,
  );
  assert.doesNotMatch(restoreCoach, /noteOpened|noteLoaded/);
  assert.match(restoreCoach, /if \(completed\) void refreshList\(\);/);
});

test("대화가 끝나면 입력창 대신 정리보기 버튼이 나온다", () => {
  const chatPanel = block("function ChatPanel({", "function Bubble({");
  assert.match(chatPanel, /noteReady \? "지금까지 이야기한 걸 정리해 뒀어요\." : "정리하고 있어요…"/);
  assert.match(chatPanel, /onClick=\{onOpenNote\}/);
  assert.match(chatPanel, /disabled=\{!noteReady\}/);
  assert.match(chatPanel, /정리보기/);
});

test("노트에서 이어서 새 연습을 누르면 되돌리기가 이어받을 연습을 함께 받는다", () => {
  const continueFromCurrent = block(
    "const continueFromCurrent = useCallback",
    "const view = describeWorkspaceView",
  );
  // 되돌리는 것과 이어받기를 켜는 것이 한 전이여야 한다. 옛 코드는 되돌린 뒤에 표시를
  // 따로 켰고, 그 순서를 뒤집으면 배너가 뜨지 않았다. 그 전이가 무엇을 만드는지는
  // tests/workspace-state.test.mjs 가 실행으로 지킨다 — 여기서는 배선만 본다.
  assert.match(continueFromCurrent, /resetTo\(\{\s*id,/);
  assert.doesNotMatch(continueFromCurrent, /resetTo\(null\)|resetToPrep\(\)/);

  // 노트 화면의 버튼이 실제로 그 길로 이어져 있어야 한다.
  const notePanel = block("<NotePanel", "<ChatPanel");
  assert.match(notePanel, /onContinueNext=\{continueFromCurrent\}/);
});

test("대화가 끝난 화면은 아직 질문 중이라고 말하지 않는다", () => {
  const chatPanel = block("function ChatPanel({", "function Bubble({");
  assert.match(chatPanel, /done \? "이번 대화는 여기까지예요" : "현재 장면을 바탕으로 질문하고 있어요"/);

  // 어느 상태에서 그 칩이 뜨는지는 tests/workspace-view.test.mjs 가 실행으로 지킨다 —
  // 여기서는 그 상태에 붙는 문구를 본다.
  const statusChip = block("function StatusChip({", "/* ── 잡다한 것");
  assert.match(statusChip, /"chat-done": \["대화 마침"/);
});
