import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  changeBlockageKind,
  changeBlockageSubBranch,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  initialBlockageFlowState,
  subBranchChoices,
} = await import("../src/features/practice/blockage-flow.ts");
const {
  completedCoachReport,
  renderablePracticeReport,
} = await import("../src/features/practice/coach-contract.ts");

const appRoot = path.resolve(import.meta.dirname, "..");
const blockageSelectionSource = readFileSync(
  path.join(appRoot, "src/features/practice/blockage-selection.tsx"),
  "utf8",
);

test("큰 갈래를 고르면 해당 하위 갈래 선택지만 제공한다", () => {
  assert.deepEqual(
    subBranchChoices("분석").map((choice) => choice.value),
    ["캐릭터 분석", "대사 분석", "그 외"],
  );
  assert.deepEqual(
    subBranchChoices("표현").map((choice) => choice.value),
    ["감정", "움직임", "화술", "표정", "그 외"],
  );

  const analysis = chooseBlockageKind(initialBlockageFlowState, "분석");
  const expression = chooseBlockageKind(initialBlockageFlowState, "표현");
  assert.equal(analysis.step, "sub");
  assert.equal(expression.step, "sub");
});

test("그 외를 고르면 하위 갈래를 건너뛴다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, "그 외");
  assert.equal(state.step, "detail");
  assert.equal(state.subBranch, "그 외");
  assert.deepEqual(subBranchChoices("그 외"), []);
});

test("바꾸기 칩은 하위 갈래와 큰 갈래의 이전 화면으로 돌아간다", () => {
  const sub = chooseBlockageKind(initialBlockageFlowState, "표현");
  assert.deepEqual(changeBlockageKind(sub), initialBlockageFlowState);

  const detail = chooseBlockageSubBranch(sub, "감정");
  assert.deepEqual(changeBlockageSubBranch(detail), {
    step: "sub",
    kind: "표현",
    subBranch: null,
    detail: "",
  });

  const otherDetail = chooseBlockageKind(initialBlockageFlowState, "그 외");
  assert.deepEqual(changeBlockageSubBranch(otherDetail), initialBlockageFlowState);
});

test("서술을 비워도 선택을 완성해 다음으로 넘어갈 수 있다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");
  const detail = chooseBlockageSubBranch(main, "표정");
  assert.deepEqual(completeBlockageFlow(detail), {
    blockage_kind: "표현",
    sub_branch: "표정",
    blockage_detail: null,
  });
});

test("서술 예시는 기본 접힘이고 예를 들면 라벨을 눌러 펼친다", () => {
  assert.match(
    blockageSelectionSource,
    /const \[examplesOpen, setExamplesOpen\] = useState\(false\)/,
  );
  assert.match(blockageSelectionSource, /aria-expanded=\{examplesOpen\}/);
  assert.match(
    blockageSelectionSource,
    /onClick=\{\(\) => setExamplesOpen\(\(current\) => !current\)\}/,
  );
  assert.match(blockageSelectionSource, /<span>예를 들면 —<\/span>/);
  assert.match(blockageSelectionSource, /\{examplesOpen \? \([\s\S]*examples\.map/);
});

test("서술을 비워도 이대로 이어가기 버튼이 활성 상태로 남는다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");
  const detail = chooseBlockageSubBranch(main, "감정");

  assert.equal(completeBlockageFlow(detail)?.blockage_detail, null);
  assert.match(
    blockageSelectionSource,
    /disabled=\{busy\}[\s\S]*?onClick=\{onComplete\}[\s\S]*?이대로 이어가기 →/,
  );
});

test("서술 화면에 되돌리기 칩과 글자 수 표시가 남아 있다", () => {
  assert.match(
    blockageSelectionSource,
    /<BackChip action=\{action\} onClick=\{onBack\} compact>\{`고른 것 · \$\{selected\}`\}<\/BackChip>/,
  );
  assert.match(blockageSelectionSource, /\{state\.detail\.length\}자/);
});

test("작은 화면용 서술 입력의 압축 레이아웃을 유지한다", () => {
  const detailStart = blockageSelectionSource.indexOf("function DetailScreen");
  const detail = blockageSelectionSource.slice(detailStart);

  assert.match(detail, /<section className="grid gap-3">/);
  assert.match(detail, /<BackChip action=\{action\} onClick=\{onBack\} compact>/);
  assert.match(detail, /<ScreenHeading[\s\S]*compact/);
  assert.match(detail, /className="flex min-h-\[44px\] w-full/);
  assert.match(detail, /className="h-\[112px\] min-h-\[112px\] max-h-\[112px\]/);
  assert.match(detail, /className="min-h-\[44px\] shrink-0/);
});

test("complete 응답의 결과를 확인 단계 없이 바로 연다", () => {
  const report = {
    report_type: "blocked",
    reason: "confirmed_expression_handoff_required",
  };
  assert.equal(completedCoachReport({
    session_id: "coach-1",
    message: "여기서 정리할게.",
    status: "continue",
    handoff: null,
    report: null,
  }), null);
  assert.deepEqual(completedCoachReport({
    session_id: "coach-1",
    message: "여기서 정리할게.",
    status: "complete",
    handoff: { id: "handoff-1", branch_kind: "expression" },
    report,
  }), report);
});

test("blocked 결과는 카드에 넘기지 않는다", () => {
  assert.equal(
    renderablePracticeReport({
      report_type: "blocked",
      reason: "confirmed_expression_handoff_required",
    }),
    null,
  );
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

test("complete가 오면 버튼 없이 결과 화면으로 전환한다", () => {
  const workspace = readFileSync(
    path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
    "utf8",
  );

  assert.match(
    workspace,
    /const completed = completedCoachReport\(turn\)[\s\S]*setReport\(completed\)[\s\S]*setMode\("note"\)/,
  );
  assert.doesNotMatch(workspace, /이제 맞아요|아직 달라요/);
});

test("blocked 결과는 대화 내용과 안내와 돌아가기 버튼을 보여준다", () => {
  const workspace = readFileSync(
    path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
    "utf8",
  );

  assert.match(workspace, /report\.report_type === "blocked"/);
  assert.match(workspace, /messages\.map/);
  assert.match(workspace, /아직 한 번도 해보지 않아서 정리할 게 부족해요/);
  assert.match(workspace, /대화로 돌아가기/);
  assert.doesNotMatch(workspace, /confirmed_expression_handoff_required/);
});

test("모든 웹 대화 화면에서 이전 확인 문구를 제거했다", () => {
  const sources = [
    "src/features/workspace/workspace-app.tsx",
    "src/features/practice/practice-flow.tsx",
    "src/features/practice/practice-single.tsx",
  ].map((file) => readFileSync(path.join(appRoot, file), "utf8")).join("\n");

  assert.doesNotMatch(sources, /이제 맞아요|아직 달라요/);
  assert.match(sources, /&apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요/);
});
