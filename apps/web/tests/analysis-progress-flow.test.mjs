import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const readWeb = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), "utf8");

const {
  coachMessageText,
  createCoachStartCoordinator,
  isCoachInputEnabled,
} = await import(
  "../src/features/practice/coach-contract.ts"
);
const {
  ANALYSIS_PROGRESS_LIMIT,
  UPLOAD_PROGRESS_END,
  advanceProgress,
  analysisProgress,
  compressionProgress,
  settleProgress,
  uploadProgress,
} = await import(
  "../src/features/practice/analysis-progress.ts"
);
const { formatVideoDuration } = await import(
  "../src/features/practice/practice-setup-flow.ts"
);

test("업로드와 장면 확인은 같은 진행 패널을 이어서 쓴다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const panel = workspace.slice(panelStart, panelEnd);

  assert.match(
    workspace,
    /mode === "uploading" \? \([\s\S]*?<ProgressPanel[\s\S]*?mode === "preparing" \? \([\s\S]*?<ProgressPanel/,
  );
  assert.match(panel, /\{value\}%/);
  assert.match(panel, /영상 올리는 중…/);
  assert.match(panel, /\$\{duration\} 영상 · 장면을 훑어보고 있어요…/);
  assert.match(panel, /role="progressbar"/);
  assert.doesNotMatch(panel, /animate-pulse|value === null/);
  assert.match(
    workspace,
    /mode === "uploading"[\s\S]*pct=\{pct\}[\s\S]*phase="upload"[\s\S]*mode === "preparing"[\s\S]*pct=\{pct\}[\s\S]*phase="scan"/,
  );
});

test("업로드와 장면 확인 진행률은 단조 증가하고 analyzed에서만 100이 된다", () => {
  const candidates = [
    compressionProgress(0.5),
    compressionProgress(1),
    uploadProgress(75),
    uploadProgress(50),
    uploadProgress(100),
    analysisProgress(0),
    analysisProgress(30_000),
    analysisProgress(60_000),
    analysisProgress(120_000),
  ];
  const values = candidates.reduce(
    (all, candidate) => [...all, advanceProgress(all.at(-1), candidate)],
    [0],
  );

  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] >= values[index - 1]);
  }
  assert.equal(uploadProgress(100), UPLOAD_PROGRESS_END);
  assert.ok(UPLOAD_PROGRESS_END < 100);
  assert.equal(analysisProgress(120_000), ANALYSIS_PROGRESS_LIMIT);
  assert.ok(ANALYSIS_PROGRESS_LIMIT < 100);
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "analyzing"), ANALYSIS_PROGRESS_LIMIT);
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "failed"), ANALYSIS_PROGRESS_LIMIT);
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "analyzed"), 100);
});

test("막힘 선택 완료 뒤에는 대화가 아니라 같은 진행 자리에서 기다린다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);

  assert.match(
    begin,
    /createPracticeSession[\s\S]*setMode\("preparing"\)[\s\S]*trackAnalysis\(session\.session_id\)/,
  );
  assert.doesNotMatch(begin, /setMode\("chat"\)|startCoach\(/);
});

test("analyzing 동안에는 coach start를 보내지 않는다", async () => {
  let starts = 0;
  const coordinator = createCoachStartCoordinator(async () => {
    starts += 1;
  });

  assert.equal(await coordinator.update("created"), "waiting");
  assert.equal(await coordinator.update("analyzing"), "waiting");
  assert.equal(starts, 0);
});

test("분석 중에는 입력이 비활성이고 analyzed 뒤 세션이 열리면 활성된다", () => {
  assert.equal(isCoachInputEnabled({
    analysisStatus: "analyzing",
    coachSessionId: null,
    sending: false,
    done: false,
  }), false);
  assert.equal(isCoachInputEnabled({
    analysisStatus: "analyzed",
    coachSessionId: "coach-1",
    sending: false,
    done: false,
  }), true);
});

test("대화 화면 진입 시 start message가 첫 코치 말풍선이 된다", () => {
  const start = {
    session_id: "coach-1",
    message: "그 말을 지금 꺼내는 이유부터 볼게.",
    status: "continue",
    handoff: null,
  };

  assert.equal(coachMessageText(start), start.message);
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  assert.match(
    workspace,
    /const message = coachMessageText\(turn\);[\s\S]*setMessages\(\(m\) => \[\.\.\.m, \{ role: "ai", text: message \}\]\)/,
  );
  assert.doesNotMatch(workspace, /이 연습에는 아직 오간 질문이 없어요/);
  assert.doesNotMatch(workspace, /막히는 대목을 그대로 적어 주세요/);
  assert.match(workspace, /sending=\{sending \|\| coachOpening\}/);
});

test("analyzed가 되면 대화로 전환하고 coach start를 한 번만 보낸다", async () => {
  let starts = 0;
  let releaseStart;
  const messages = [];
  const coordinator = createCoachStartCoordinator(
    () => new Promise((resolve) => {
      starts += 1;
      releaseStart = () => {
        messages.push("코치의 첫 질문");
        resolve();
      };
    }),
  );

  const first = coordinator.update("analyzed");
  const second = coordinator.update("analyzed");
  await Promise.resolve();
  assert.equal(starts, 1);
  releaseStart();
  assert.deepEqual(await Promise.all([first, second]), ["started", "started"]);
  assert.equal(await coordinator.update("analyzed"), "started");
  assert.equal(starts, 1);
  assert.deepEqual(messages, ["코치의 첫 질문"]);

  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const coordinatorStart = workspace.indexOf("const coordinator = createCoachStartCoordinator");
  const coordinatorEnd = workspace.indexOf("coachCoordinatorRef.current", coordinatorStart);
  const coordinatorBlock = workspace.slice(coordinatorStart, coordinatorEnd);
  const modeChange = workspace.indexOf('setMode("chat")', coordinatorStart);
  const request = workspace.indexOf("await startCoach", coordinatorStart);
  assert.ok(modeChange > coordinatorStart && modeChange < request);
  assert.doesNotMatch(coordinatorBlock, /setSending\(true\)/);
  assert.match(workspace, /coordinatorFor\(practiceSessionId\)\.update\(settled\.status\)/);
  assert.match(workspace, /const \{ data: start \} = await startCoach[\s\S]*restoreCoach\(start\)/);
  assert.match(workspace, /turn\.turns\?\.map[\s\S]*setMessages/);
  assert.match(workspace, /restartAfterBlocked[\s\S]*restart: true/);
});

test("failed면 같은 진행 자리에 그냥 시작 버튼을 보이고 근거 없이 시작한다", async () => {
  let starts = 0;
  const coordinator = createCoachStartCoordinator(async () => {
    starts += 1;
  });

  assert.equal(await coordinator.update("failed"), "failed");
  assert.equal(starts, 0);
  assert.equal(await coordinator.startWithoutEvidence(), "started");
  assert.equal(starts, 1);

  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const panel = workspace.slice(panelStart, panelEnd);
  assert.match(panel, /영상을 바탕으로 질문을 준비하지 못했어요/);
  assert.match(panel, /영상 근거 없이 대화를 시작할 수 있어요/);
  assert.match(panel, /onClick=\{onStartWithoutEvidence\}/);
  assert.match(panel, /starting \? "질문 준비 중…" : "그냥 시작"/);
  assert.match(
    workspace,
    /failed=\{analysisStatus === "failed"\}[\s\S]*startConversationWithoutEvidence\(activeId\)/,
  );
});

test("장면 확인 중에도 상황·인물·목표는 읽기 전용으로 남는다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");

  assert.match(
    workspace,
    /<SceneForm[\s\S]*situation=\{visibleScene\.situation\}[\s\S]*character=\{visibleScene\.character\}[\s\S]*goal=\{visibleScene\.goal\}[\s\S]*locked=\{waitingForCoach\}/,
  );
  assert.match(workspace, /readOnly=\{disabled\}/);
});

test("통합 진행 자리 문구에 금지된 표현이 없다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const panel = workspace.slice(panelStart, panelEnd);
  const userFacingCopy = [
    ...[...panel.matchAll(/>([^<>{}\n]*[가-힣][^<>{}\n]*)</g)].map((match) => match[1]),
    ...[...panel.matchAll(/\b(?:placeholder|aria-label|title|alt)=["']([^"']+)["']/g)]
      .map((match) => match[1]),
    ...[...panel.matchAll(/["'`]([^"'`\n]*[가-힣][^"'`\n]*)["'`]/g)]
      .map((match) => match[1]),
  ].join("\n");

  assert.doesNotMatch(userFacingCopy, /분석 중|평가 중|리포트|점수/);
});

test("영상 길이를 분과 초로 표시한다", () => {
  assert.equal(formatVideoDuration(72_000), "1분 12초");
  assert.equal(formatVideoDuration(12_000), "12초");
  assert.equal(formatVideoDuration(null), null);
});

test("복구한 세션은 대기 상태만 진행 자리를 거치고 analyzed면 대화로 간다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const restoreStart = workspace.indexOf("const openSession = useCallback");
  const restoreEnd = workspace.indexOf("// 주소에 ?session=", restoreStart);
  const restore = workspace.slice(restoreStart, restoreEnd);

  assert.match(
    restore,
    /loaded\.status === "created" \|\| loaded\.status === "analyzing"[\s\S]*setMode\("preparing"\)[\s\S]*trackAnalysis\(id\)/,
  );
  assert.match(restore, /loaded\.status === "failed"[\s\S]*setMode\("preparing"\)/);
  assert.match(
    restore,
    /setMode\("chat"\)[\s\S]*getReport\(id\)[\s\S]*startConversationAfterAnalysis\(id\)/,
  );
});
