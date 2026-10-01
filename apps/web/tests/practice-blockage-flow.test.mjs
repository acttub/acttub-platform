import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  BLOCKAGE_CHOICES,
  chooseBlockageKind,
  completeBlockageFlow,
  completeBlockageFlowWithDefault,
  initialBlockageFlowState,
} = await import("../src/features/practice/blockage-flow.ts");
const { isConversationDone } = await import(
  "../src/features/practice/conversation-view.ts"
);

const appRoot = path.resolve(import.meta.dirname, "..");
const blockageSelectionSource = readFileSync(
  path.join(appRoot, "src/features/practice/blockage-selection.tsx"),
  "utf8",
);

/**
 * 서술 자리만 잘라 낸다. 끝을 안 막으면 뒤에 함수가 붙는 날 창이 파일 끝까지
 * 벌어지고, 그때부터 아래 단언들은 저절로 통과한다.
 */
function detailPanelSource() {
  const start = blockageSelectionSource.indexOf("function DetailPanel({");
  assert.notEqual(start, -1, "서술 자리를 못 찾았다");
  const end = blockageSelectionSource.indexOf("\nfunction ", start + 1);
  return blockageSelectionSource.slice(
    start,
    end === -1 ? blockageSelectionSource.length : end,
  );
}

test("화면에 그리는 라벨은 저장값과 다른 문장이다", () => {
  // 라벨 자리에 저장값을 그대로 쓰면 배우가 카드 제목으로 "그 외"를 읽는다(SOMA-454).
  // 값은 서버가 코치를 가르는 데 쓰고, 화면은 문장을 쓴다.
  for (const choice of BLOCKAGE_CHOICES) {
    assert.notEqual(choice.label, choice.value, choice.value);
    assert.ok(choice.label.length > choice.value.length, choice.value);
  }
});

test("대분류만 골라도 완성되고 하위 갈래는 '특정하지 않음'으로 간다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, "표현");

  // "그 외"는 서버가 이미 아는 값이고, 직접 고른 사람과 안 고른 사람 모두에게
  // 참인 표현이다. CHECK 제약이 빈 문자열을 거부해 중립값을 새로 만들 수 없다.
  assert.deepEqual(completeBlockageFlow(state), {
    blockage_kind: "표현",
    sub_branch: "그 외",
    blockage_detail: null,
  });
});

test("좁힐 것이 없는 대분류는 하위 갈래 자리 없이 그대로 완성된다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, "그 외");

  assert.deepEqual(completeBlockageFlow(state), {
    blockage_kind: "그 외",
    sub_branch: "그 외",
    blockage_detail: null,
  });
});

test("대분류를 고르기 전에는 완성되지 않는다", () => {
  assert.equal(completeBlockageFlow(initialBlockageFlowState), null);
  // 값이 동작을 가른다 — 대분류가 "분석"일 때만 대사 전사가 돌고 코치 프롬프트와
  // 노트 틀도 여기서 갈린다. 중립값을 자동으로 채우면 전사가 조용히 꺼진다.
  assert.equal(
    completeBlockageFlow({ ...initialBlockageFlowState, detail: "적어는 뒀다" }),
    null,
  );
});

test("도움을 고르지 않아도 그 외 기본값으로 완성한다", () => {
  assert.deepEqual(completeBlockageFlowWithDefault(initialBlockageFlowState), {
    blockage_kind: "그 외",
    sub_branch: "그 외",
    blockage_detail: null,
  });
  assert.deepEqual(
    completeBlockageFlowWithDefault({
      ...initialBlockageFlowState,
      detail: "  영상 후반의 호흡을 보고 싶어요  ",
    }),
    {
      blockage_kind: "그 외",
      sub_branch: "그 외",
      blockage_detail: "영상 후반의 호흡을 보고 싶어요",
    },
  );
});

test("서술 자리는 예시·펼치기 없이 상세 칸 하나만 둔다", () => {
  // 2026-09-01 결정 — 하위 갈래·예시 접기·글자 수를 걷어내고 상세 서술 한 칸만 남겼다.
  assert.match(blockageSelectionSource, /상세히 적어 주세요/);
  assert.match(blockageSelectionSource, /<textarea/);
  assert.doesNotMatch(blockageSelectionSource, /예를 들면|펼치기|examplesOpen/);
  assert.doesNotMatch(blockageSelectionSource, /조금 더 좁혀 볼까요/);
});

test("서술을 비워도 고른 도움은 완성된다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");

  assert.equal(completeBlockageFlow(main)?.blockage_detail, null);
});

test("고른 선택 표시가 남아 있고 글자 수 표시는 없다", () => {
  assert.match(blockageSelectionSource, /aria-pressed=\{selected\}/);
  assert.doesNotMatch(blockageSelectionSource, /\.length\}자/);
});


test("서술 입력은 섹션 제목이 h2 로 서고 한 칸으로 유지된다", () => {
  assert.match(blockageSelectionSource, /<section className="grid gap-3">/);
  // 제목은 h2 다 — 한 화면이 되면서 h1 이 둘이 되지 않게 갈랐다.
  assert.match(blockageSelectionSource, /<h2 /);
  assert.equal((blockageSelectionSource.match(/<textarea/g) ?? []).length, 1);
});

test("practice.coach: complete 응답의 노트를 확인 단계 없이 바로 받는다", () => {
  // 신형에는 분석 확인·후보 선택 단계가 없다(ADR-027). 종료 응답이 노트를 그대로 싣고,
  // 화면은 마지막 인사를 보여 준 뒤 배우가 누를 때 노트로 넘어간다.
  const head = { id: "c-1", revision: 5, status: "open" };
  const note = { id: "n-1", format: "v2", kind: "action", title: "말끝", summary_quotes: [], next_take: null, actor_words: [], corrections: [], tags: [], fallback: false, cheer: null, source_revision: 5, created_at: "2026-09-21T03:00:00Z" };

  assert.equal(isConversationDone({ conversation: head, message: "여기서 정리할게.", status: "continue", note: null }), false);
  assert.equal(isConversationDone({ conversation: { ...head, status: "closed" }, message: "여기서 정리할게.", note }), true);
  // 대화가 닫혔다는 것은 대화 상태로도 온다.
  assert.equal(isConversationDone({ conversation: { ...head, status: "closed" }, message: "", status: "continue", note }), true);
});

test("새 선택 화면과 오늘 정리 화면에 금지 문구가 없다", () => {
  const files = [
    "src/features/practice/blockage-selection.tsx",
    "src/features/practice/practice-report-cards.tsx",
    "src/features/workspace/workspace-app.tsx",
  ];
  const matches = files.flatMap((file) => {
    const source = readFileSync(path.join(appRoot, file), "utf8");
    return ["리포트", "점수", "등급"]
      .filter((word) => source.includes(word))
      .map((word) => `${file}: ${word}`);
  });
  assert.deepEqual(matches, []);
});

test("complete가 오면 코치 응답에서 노트를 꺼내 받아 둔다", () => {
  const workspace = readFileSync(
    path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
    "utf8",
  );
  // 옛 정규식은 900줄 떨어진 두 심볼을 `[\s\S]*` 로 이어 "노트 화면으로 자동 전환한다"
  // 고 읽혔고, 그것은 tests/workspace-note-handoff.test.mjs 가 고정하는 것과 정반대였다.
  // 노트 화면으로 넘기는 자리는 그 파일이 지킨다. 여기서는 받아 두는 쪽만 본다.
  const pushAi = workspace.slice(
    workspace.indexOf("const pushAi = useCallback"),
    workspace.indexOf("const openNote = useCallback"),
  );

  // 노트는 종료 응답에 실려 온다(practice.note).
  assert.match(pushAi, /report: turn\.note \?\? null,/);
  // 받아 둔 노트는 화면이 든다. 안 딸려 온 턴이 그것을 지우지 않는 것은
  // tests/workspace-state.test.mjs 가 실행으로 지킨다.
  assert.match(pushAi, /done,/);
  assert.doesNotMatch(workspace, /이제 맞아요|아직 달라요/);
});

test("blocked 결과는 대화 내용과 안내와 마치기·다시 시작 버튼을 보여준다", () => {
  const workspace = readFileSync(
    path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
    "utf8",
  );
  const blockedStart = workspace.indexOf("if (isBlockedReport(report))");
  const regularNoteStart = workspace.indexOf("\n  return (", blockedStart);
  const blocked = workspace.slice(blockedStart, regularNoteStart);

  assert.notEqual(blockedStart, -1);
  assert.notEqual(regularNoteStart, -1);
  assert.match(blocked, /messages\.map/);
  assert.match(blocked, /지금까지 나눈 이야기는 연습 노트로 남지 않아요/);
  assert.match(blocked, /다시 대화하면 이 내용은 사라지고 처음부터 시작해요/);
  assert.match(blocked, /onClick=\{onFinish\}[\s\S]*연습 마치기/);
  // 뒤에서 도는 일이 이 길을 막을 수 있다. 무엇이 그것을 켜고 끄는지는
  // tests/use-workspace-busy.test.mjs 가 실행으로 지킨다.
  assert.match(
    blocked,
    /disabled=\{backDisabled\}[\s\S]*onClick=\{onBackToChat\}[\s\S]*disabled:bg-\[#c9d3df\][\s\S]*처음부터 다시 대화하기/,
  );
  assert.doesNotMatch(blocked, /대화로 돌아가기|다음에 이어서/);
  assert.doesNotMatch(workspace, /confirmed_expression_handoff_required/);
});

test("모든 웹 대화 화면에서 이전 확인 문구를 제거했다", () => {
  const sources = [
    "src/features/workspace/workspace-app.tsx",
  ].map((file) => readFileSync(path.join(appRoot, file), "utf8")).join("\n");

  assert.doesNotMatch(sources, /이제 맞아요|아직 달라요/);
  // 종료 안내는 coach-composer.test.mjs에서 실제 렌더 결과로 확인한다.
});
