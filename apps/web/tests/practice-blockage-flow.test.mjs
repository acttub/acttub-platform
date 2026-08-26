import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  BLOCKAGE_CHOICES,
  changeBlockageKind,
  chooseBlockageKind,
  chooseBlockageSubBranch,
  completeBlockageFlow,
  effectiveSubBranch,
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

test("큰 갈래를 고르면 해당 하위 갈래 선택지만 제공한다", () => {
  assert.deepEqual(
    subBranchChoices("분석").map((choice) => choice.value),
    ["캐릭터 분석", "대사 분석", "그 외"],
  );
  assert.deepEqual(
    subBranchChoices("표현").map((choice) => choice.value),
    ["감정", "움직임", "화술", "표정", "그 외"],
  );
  // "그 외"는 좁힐 것이 없다 — 목록이 비어 하위 갈래 자리가 아예 서지 않는다.
  assert.deepEqual(subBranchChoices("그 외"), []);
});

test("화면에 그리는 라벨은 저장값과 다른 문장이다", () => {
  // 라벨 자리에 저장값을 그대로 쓰면 배우가 카드 제목으로 "그 외"를 읽는다(SOMA-454).
  // 값은 서버가 코치를 가르는 데 쓰고, 화면은 문장을 쓴다.
  for (const choice of BLOCKAGE_CHOICES) {
    assert.notEqual(choice.label, choice.value, choice.value);
    assert.ok(choice.label.length > choice.value.length, choice.value);
  }
});

test("하위 갈래 「그 외」도 저장값을 그대로 보여주지 않는다", () => {
  // 대분류만 고치면 다음 화면에서 배우가 카드 제목으로 "그 외"를 읽는다(SOMA-454).
  for (const kind of ["분석", "표현"]) {
    const other = subBranchChoices(kind).find((choice) => choice.value === "그 외");
    assert.notEqual(other.label, "그 외", kind);
  }
});

test("대분류만 골라도 완성되고 하위 갈래는 '특정하지 않음'으로 간다", () => {
  const state = chooseBlockageKind(initialBlockageFlowState, "표현");

  assert.equal(state.subBranch, null);
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

  assert.deepEqual(subBranchChoices("그 외"), []);
  assert.equal(effectiveSubBranch(state), "그 외");
  assert.deepEqual(completeBlockageFlow(state), {
    blockage_kind: "그 외",
    sub_branch: "그 외",
    blockage_detail: null,
  });
  // 목록이 없으니 고를 수도 없다 — 눌러 봐야 아무 일도 일어나지 않는다.
  assert.deepEqual(chooseBlockageSubBranch(state, "감정"), state);
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

test("화면이 말하는 하위 갈래와 저장되는 값이 같은 답을 본다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");

  // 안 고른 사람의 화면 제목·예시가 이 답을 따라간다. 갈라 적으면 "화면은 그 외인데
  // 저장은 다른 것"이 되고, 그 어긋남은 마크업을 못 보는 테스트에 안 걸린다.
  assert.equal(effectiveSubBranch(main), "그 외");
  assert.equal(completeBlockageFlow(main)?.sub_branch, effectiveSubBranch(main));

  const chosen = chooseBlockageSubBranch(main, "화술");
  assert.equal(effectiveSubBranch(chosen), "화술");
  assert.equal(completeBlockageFlow(chosen)?.sub_branch, effectiveSubBranch(chosen));

  // 화면은 이제 하위 갈래로 제목·예시를 가르지 않는다(상세 문안 한 벌, SOMA-454).
  // 갈릴 표면이 없어져 그것을 지키던 소스 순찰도 함께 걷었다.
});

test("하위 갈래를 고르면 그 값이 실린다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");
  const chosen = chooseBlockageSubBranch(main, "표정");

  assert.deepEqual(completeBlockageFlow(chosen), {
    blockage_kind: "표현",
    sub_branch: "표정",
    blockage_detail: null,
  });
});

test("대분류를 되돌리면 하위 갈래도 함께 지운다", () => {
  const chosen = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, "표현"),
    "감정",
  );

  assert.deepEqual(changeBlockageKind(chosen), initialBlockageFlowState);
  // 적어 둔 서술은 남긴다 — 대분류를 다시 고르는 것과 적은 것을 버리는 것은 다르다.
  const withDetail = { ...chosen, detail: "2분 언저리에서 얼굴이 굳어요" };
  assert.equal(changeBlockageKind(withDetail).detail, "2분 언저리에서 얼굴이 굳어요");
});

test("대분류를 갈아타면 앞서 고른 하위 갈래는 따라가지 않는다", () => {
  const chosen = chooseBlockageSubBranch(
    chooseBlockageKind(initialBlockageFlowState, "표현"),
    "감정",
  );

  // "감정"은 분석의 선택지가 아니다. 남겨 두면 목록에 없는 값이 실려 나간다.
  assert.equal(chooseBlockageKind(chosen, "분석").subBranch, null);
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

test("서술을 비워도 이대로 이어가기 버튼이 활성 상태로 남고, 잠겨도 문구는 그대로다", () => {
  const main = chooseBlockageKind(initialBlockageFlowState, "표현");
  const detail = chooseBlockageSubBranch(main, "감정");

  assert.equal(completeBlockageFlow(detail)?.blockage_detail, null);
  // 창은 그 버튼이 사는 자리로 끊는다 — 파일 전체를 두고 이어 붙이면 멀리 떨어진
  // 두 심볼이 한 단언을 만족한다(apps/web/CLAUDE.md 가 실물로 경고한 모양).
  assert.match(
    detailPanelSource(),
    /disabled=\{submitDisabled\}[\s\S]*?onClick=\{onComplete\}[\s\S]*?disabled:bg-\[#c9d3df\][\s\S]*?이대로 이어가기 →/,
  );
  // 그 잠금은 화면 뒤에서 도는 **다른** 일이 이 연습을 붙들고 있다는 뜻이다(실제로
  // 켜지는 것은 지우는 중일 때뿐이다). 이 화면이 무언가를 진행 중이라고 말하면
  // 거짓이 된다 — 옛 문구가 그랬다.
  assert.doesNotMatch(blockageSelectionSource, /이어가는 중/);
});

test("고른 대분류를 되돌리는 칩과 글자 수 표시가 남아 있다", () => {
  // 칩은 이제 화면 맨 위에 하나뿐이다 — 되돌릴 것이 대분류 하나이기 때문이다.
  // 하위 갈래는 목록이 그대로 서 있어 눌러서 바꾼다.
  assert.match(
    blockageSelectionSource,
    /action="바꾸기"[\s\S]{0,200}?changeBlockageKind\(current\)[\s\S]{0,160}?`고른 것 · \$\{blockageKindShortName\(state\.kind\)\}`/,
  );
  assert.match(blockageSelectionSource, /\{state\.detail\.length\}자/);
});


test("작은 화면용 서술 입력의 압축 레이아웃을 유지한다", () => {
  const detail = detailPanelSource();

  assert.match(detail, /<section className="grid gap-3">/);
  // 제목은 h2 다 — 한 화면이 되면서 h1 이 둘이 되지 않게 갈랐다.
  assert.match(detail, /<SectionHeading/);
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

  assert.match(pushAi, /const completed = completedCoachReport\(turn\);/);
  // 받아 둔 노트는 화면이 든다. 안 딸려 온 턴이 그것을 지우지 않는 것은
  // tests/workspace-state.test.mjs 가 실행으로 지킨다.
  assert.match(pushAi, /report: completed,/);
  assert.doesNotMatch(workspace, /이제 맞아요|아직 달라요/);
});

test("blocked 결과는 대화 내용과 안내와 마치기·다시 시작 버튼을 보여준다", () => {
  const workspace = readFileSync(
    path.join(appRoot, "src/features/workspace/workspace-app.tsx"),
    "utf8",
  );
  const blockedStart = workspace.indexOf('if (report.report_type === "blocked")');
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
  assert.match(sources, /&apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요/);
});
