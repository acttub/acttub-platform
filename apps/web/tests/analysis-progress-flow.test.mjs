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
  ANALYSIS_DEADLINE_MS,
  ANALYSIS_PROGRESS_LIMIT,
  COMPRESS_PROGRESS_END,
  UPLOAD_ONLY_PROGRESS_END,
  UPLOAD_PROGRESS_END,
  advanceProgress,
  analysisProgress,
  analysisStart,
  compressionProgress,
  isAnalysisPastDeadline,
  settleProgress,
  uploadProgress,
} = await import(
  "../src/features/practice/analysis-progress.ts"
);
const { formatVideoDuration } = await import(
  "../src/features/practice/practice-setup-flow.ts"
);

// 진행 패널이 무엇을 그리는지만 본다. 막대가 언제 얼마나 차는지는
// use-analysis-progress.test.mjs 가 훅을 실제로 돌려서 본다.
test("진행 패널은 같은 자리에 퍼센트와 막대를 그린다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const panel = workspace.slice(panelStart, panelEnd);

  assert.match(panel, /\{value\}%/);
  assert.match(panel, /style=\{\{ width: `\$\{width\}%` \}\}/);
  assert.doesNotMatch(panel, /style=\{\{ width: `\$\{value\}%` \}\}/);
  assert.match(panel, /영상 올리는 중…/);
  assert.match(panel, /\$\{duration\} 영상 · 장면을 훑어보고 있어요…/);
  assert.match(panel, /role="progressbar"/);
  assert.doesNotMatch(panel, /animate-pulse|value === null/);
});

test("연습 주소를 갈아끼울 때 라우터 네비게이션을 타지 않는다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");

  // router.replace 로 되돌리면 useSearchParams 를 감싼 Suspense 가 다시 걸려
  // 업로드가 끝나는 지점에서 흰 화면이 한 번 깜빡인다.
  assert.match(workspace, /window\.history\.replaceState\(null, "", path\)/);
  assert.doesNotMatch(workspace, /router\.replace\(["`]\/practice\/new/);
  assert.match(workspace, /replaceUrl\(`\/practice\/new\?session=/);
  // 화면을 실제로 옮기는 이동은 그대로 라우터를 쓴다.
  assert.match(workspace, /router\.replace\(`\/login\?next=/);
});

test("업로드가 끝나도 방금 고른 로컬 영상을 그대로 재생한다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");

  // 서버 playback_url 을 먼저 쓰면 업로드가 끝나는 순간 src 가 갈아끼워져
  // 영상 자리가 비었다 돌아오고 onDuration 이 다시 불린다.
  // 우선순위 자체는 tests/workspace-view.test.mjs 가 실행으로 지킨다 — 여기서는
  // 화면이 그 판단을 거쳐서 영상을 튼다는 배선만 본다.
  assert.match(workspace, /src=\{body\.video\.src\}/);

  // 화면이 로컬 원본을 놓는 순간 그 blob 주소도 놓아 준다. 어느 화면이 그것을
  // 들고 있고 언제 놓는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다.
  const revokeStart = workspace.indexOf("const pickedUrl = pickedVideo(screen)");
  const revokeEnd = workspace.indexOf("[pickedUrl],", revokeStart);
  // 끝을 못 찾으면 slice 가 파일 끝까지를 창으로 잡아 아래 단언이 저절로 통과한다.
  assert.ok(revokeStart !== -1 && revokeEnd > revokeStart, "blob 정리 자리를 못 찾았다");
  const revokeEffect = workspace.slice(revokeStart, revokeEnd);
  assert.match(revokeEffect, /URL\.revokeObjectURL\(pickedUrl\)/);

  // 그 정리에 요청 끊기를 섞으면 안 된다 — 근거 없이 대화를 시작하는 길은
  // 훑어보기 자리를 떠나면서 영상을 놓는데, 그때 폴링까지 함께 죽는다.
  assert.doesNotMatch(revokeEffect, /abort\(\)/);
});

test("압축 구간은 초반이 빠르고 후반이 느린 곡선으로 찬다", () => {
  // 양 끝은 선형과 같다.
  assert.equal(compressionProgress(0), 0);
  assert.equal(compressionProgress(1), COMPRESS_PROGRESS_END);
  // 같은 지점에서 선형보다 앞선다 — 시작하자마자 눈에 띄게 움직여야 한다.
  assert.ok(compressionProgress(0.25) > 0.25 * COMPRESS_PROGRESS_END);
  assert.ok(compressionProgress(0.5) > 0.5 * COMPRESS_PROGRESS_END);
  // 앞 4분의 1이 뒤 4분의 1보다 훨씬 많이 채운다.
  const firstQuarter = compressionProgress(0.25) - compressionProgress(0);
  const lastQuarter = compressionProgress(1) - compressionProgress(0.75);
  assert.ok(firstQuarter > lastQuarter * 5);
  // 곡선이어도 뒤로 가지 않는다.
  for (let step = 1; step <= 10; step += 1) {
    assert.ok(compressionProgress(step / 10) > compressionProgress((step - 1) / 10));
  }
});

test("업로드와 장면 확인 진행률은 단조 증가하고 analyzed에서만 100이 된다", () => {
  const candidates = [
    compressionProgress(0.5),
    compressionProgress(1),
    uploadProgress(75, true),
    uploadProgress(50, true),
    uploadProgress(100, true),
    analysisProgress(0, 47_000, analysisStart(true)),
    analysisProgress(30_000, 47_000, analysisStart(true)),
    analysisProgress(60_000, 47_000, analysisStart(true)),
    analysisProgress(120_000, 47_000, analysisStart(true)),
  ];
  const values = candidates.reduce(
    (all, candidate) => [...all, advanceProgress(all.at(-1), candidate)],
    [0],
  );

  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] >= values[index - 1]);
  }
  // 압축을 탄 폰 경로: 압축 0→80 · 업로드 80→90 · 분석 90→99.
  assert.equal(compressionProgress(1), COMPRESS_PROGRESS_END);
  assert.equal(uploadProgress(0, true), COMPRESS_PROGRESS_END);
  assert.equal(uploadProgress(100, true), UPLOAD_PROGRESS_END);
  assert.ok(UPLOAD_PROGRESS_END < 100);
  // 압축을 건너뛴 노트북 경로: 업로드 0→60 · 분석 60→99.
  assert.equal(uploadProgress(0, false), 0);
  assert.equal(uploadProgress(100, false), UPLOAD_ONLY_PROGRESS_END);
  assert.ok(UPLOAD_ONLY_PROGRESS_END < UPLOAD_PROGRESS_END);
  // 압축을 탄 쪽이 같은 업로드 진행률에서 항상 앞선다 — 앞 구간을 이미 채웠기 때문이다.
  assert.ok(uploadProgress(50, false) < uploadProgress(50, true));
  // 분석 구간은 두 경로 모두 자기 시작점에서 출발한다.
  assert.equal(analysisProgress(0, 47_000, analysisStart(true)), UPLOAD_PROGRESS_END);
  assert.equal(analysisProgress(0, 47_000, analysisStart(false)), UPLOAD_ONLY_PROGRESS_END);
  assert.ok(analysisProgress(600_000, 47_000, analysisStart(true)) < ANALYSIS_PROGRESS_LIMIT);
  assert.ok(ANALYSIS_PROGRESS_LIMIT < 100);
  assert.ok(
    analysisProgress(30_000, 47_000, analysisStart(true))
      > analysisProgress(10_000, 47_000, analysisStart(true)),
  );
  // 선형 구간 끝은 영상 길이의 0.45배다(47초 영상 → 21.15초).
  const span = 21_150;
  assert.equal(analysisProgress(span, 47_000, analysisStart(true)), 95);
  // 경계 양쪽에서 95로 이어지고, 지난 직후에도 계속 증가한다.
  assert.ok(Math.abs(analysisProgress(span - 1, 47_000, analysisStart(true)) - 95) < 0.001);
  assert.ok(Math.abs(analysisProgress(span + 1, 47_000, analysisStart(true)) - 95) < 0.001);
  assert.ok(
    analysisProgress(span + 1, 47_000, analysisStart(true))
      > analysisProgress(span, 47_000, analysisStart(true)),
  );
  // 폰 실사용에서 역산한 실제 분석 시간(영상 길이의 0.44배)이 그보다 살짝 앞이라,
  // 분석이 끝나는 순간 막대는 95 직전에서 아직 움직이는 중이다.
  const atRealEnd = analysisProgress(0.44 * 47_000, 47_000, analysisStart(true));
  assert.ok(atRealEnd < 95);
  assert.ok(atRealEnd > 94);
  // 긴 영상은 같은 시각에 덜 찬다.
  assert.ok(
    analysisProgress(30_000, 120_000, analysisStart(true))
      < analysisProgress(30_000, 47_000, analysisStart(true)),
  );
  // 목록에서 연 세션은 길이도 압축 여부도 모르지만 그래도 구간 안에서 움직인다.
  const noDuration = analysisProgress(10_000, null, analysisStart(false));
  assert.ok(
    noDuration > UPLOAD_ONLY_PROGRESS_END && noDuration < ANALYSIS_PROGRESS_LIMIT,
  );
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "analyzing"), ANALYSIS_PROGRESS_LIMIT);
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "failed"), ANALYSIS_PROGRESS_LIMIT);
  assert.equal(settleProgress(ANALYSIS_PROGRESS_LIMIT, "analyzed"), 100);
});

test("250초 동안 분석해도 진행률은 멈추지 않고 단조 증가한다", () => {
  const values = Array.from(
    { length: 251 },
    (_, seconds) => analysisProgress(seconds * 1000, 47_000, analysisStart(true)),
  );

  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] > values[index - 1]);
  }
  assert.ok(values.at(-1) < ANALYSIS_PROGRESS_LIMIT);
});

// 경과 시간을 재고 목표 시간을 넘겼는지 가르는 일은 훅이 한다
// (use-analysis-progress.test.mjs). 여기서는 넘겼을 때 바뀌는 문구만 본다.
test("분석 목표 시간 60초를 넘기면 진행 중임을 다시 안내한다", () => {
  assert.equal(isAnalysisPastDeadline(ANALYSIS_DEADLINE_MS), false);
  assert.equal(isAnalysisPastDeadline(ANALYSIS_DEADLINE_MS + 1), true);

  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const panel = workspace.slice(panelStart, panelEnd);
  assert.match(
    panel,
    /pastDeadline[\s\S]*평소보다 오래 걸리고 있어요 · 장면을 계속 살펴보고 있어요…/,
  );
});

test("질문 받기를 누르면 막힘을 고르기 전에 압축·업로드가 시작된다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const rowStart = workspace.indexOf("<StartRow");
  const startRow = workspace.slice(rowStart, workspace.indexOf("/>", rowStart));
  // 막힘 선택으로 넘어가기 전에 업로드를 띄운다 — 뒤로 미루면 고르는 시간과
  // 올리는 시간을 더해서 기다리게 된다.
  assert.match(
    startRow,
    /startUpload\(picked\.file\)[\s\S]*dispatch\(\{ type: "blockageChosen" \}\)/,
  );

  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);
  // begin 은 이미 도는 업로드를 이어받는다. 여기서 다시 압축부터 하면 두 번 올린다.
  assert.match(begin, /await promise/);
  assert.doesNotMatch(begin, /prepareVideoUpload\(/);

  // 완료 처리는 배우가 시작을 확정한 뒤에만 한다 — 미리 완료해 두면 도중에
  // 그만둔 영상이 만료 스윕에 안 걸려 S3 에 남는다.
  assert.match(workspace, /finalize: false/);
  assert.match(begin, /finalizeUpload\(intentId/);

  // 연습을 떠나거나 영상을 바꾸면 올리던 것을 끊는다.
  // 되돌리는 길은 이어받기를 켜고 가는 것과 안 켜고 가는 것 둘이고, 둘 다 이 자리를 지난다.
  assert.match(workspace, /const resetTo = useCallback\(\(continueFrom: ContinueFrom \| null\) => \{\s*discardPendingUpload\(\)/);
  assert.match(workspace, /const resetToPrep = useCallback\(\(\) => resetTo\(null\)/);
  const pickStart = workspace.indexOf("const onPickFile");
  const pickEnd = workspace.indexOf("const startUpload = useCallback", pickStart);
  assert.ok(pickStart !== -1 && pickEnd > pickStart, "영상 고르는 자리를 못 찾았다");
  assert.match(workspace.slice(pickStart, pickEnd), /discardPendingUpload\(\)/);
});

test("막힘 선택 완료 뒤에는 대화가 아니라 같은 진행 자리에서 기다린다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);

  // 그 전이가 무엇으로 가는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다 —
  // 여기서는 세션 생성과 폴링 사이 어디에 그것이 놓이는지를 본다.
  assert.match(
    begin,
    /createPracticeSession[\s\S]*dispatch\(\{ type: "sessionCreated", status: session\.status \}\)[\s\S]*trackAnalysis\(session\.session_id\)/,
  );
  assert.doesNotMatch(begin, /type: "coachStarting"|startCoach\(/);
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
  // 둘을 한꺼번에 어긋나게 두면 어느 쪽이 막는지 가리지 못한다. 훑어보기가 안 끝난
  // 것만으로도 입력은 닫혀 있어야 한다 — 코치가 붙어 있어도 마찬가지다.
  assert.equal(isCoachInputEnabled({
    analysisStatus: "analyzing",
    coachSessionId: "coach-1",
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
  const screenChange = workspace.indexOf(
    'dispatch({ type: "coachStarting" })',
    coordinatorStart,
  );
  const request = workspace.indexOf("await startCoach", coordinatorStart);
  assert.ok(screenChange > coordinatorStart && screenChange < request);
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
    /failed=\{body\.footer\.failed\}[\s\S]*startConversationWithoutEvidence\(activeId\)/,
  );
});

test("장면 확인 중에도 상황·인물·목표는 읽기 전용으로 남는다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");

  assert.match(
    workspace,
    /<SceneForm[\s\S]*situation=\{visibleScene\.situation\}[\s\S]*character=\{visibleScene\.character\}[\s\S]*goal=\{visibleScene\.goal\}[\s\S]*locked=\{body\.sceneLocked\}/,
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

  // 조회 전 진입 구간은 지난 연습의 흔적을 걷어낸다. 이 전이가 빠지면 앞 연습의
  // "대화 마침"·훑어보기 실패 표시가 새로 연 화면에 그대로 남는다.
  // 무엇을 걷어내는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다.
  const entry = restore.slice(0, restore.indexOf("await getPracticeSession"));
  assert.match(entry, /dispatch\(\{ type: "sessionOpening" \}\)/);

  // 받아 온 상태로 화면을 먼저 옮기고, 그다음에 폴링·노트 조회로 갈린다.
  // 어느 상태가 어느 자리로 가는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다.
  assert.match(
    restore,
    /dispatch\(\{ type: "sessionLoaded", status: loaded\.status \}\)[\s\S]*loaded\.status === "created" \|\| loaded\.status === "analyzing"[\s\S]*trackAnalysis\(id\)/,
  );
  // 훑어보기가 실패한 연습은 그 자리에서 멈춘다 — 폴링도 코치도 부르지 않는다.
  const failedBranch = restore.slice(
    restore.indexOf('if (loaded.status === "failed")'),
    restore.indexOf("const found = await getReport"),
  );
  assert.match(failedBranch, /return;/);
  assert.doesNotMatch(failedBranch, /trackAnalysis|startCoach|coachStarting|getReport/);
  assert.match(
    restore,
    /getReport\(id\)[\s\S]*dispatch\(\{ type: "noteLoaded" \}\)[\s\S]*startConversationAfterAnalysis\(id\)/,
  );
});
