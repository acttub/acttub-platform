import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const readWeb = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), "utf8");

/** 두 끝을 다 방어한다 — 못 찾으면 창이 파일 끝까지 벌어져 거짓 초록이 된다. */
function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} 를 찾지 못했다`);
  return source.slice(start, end);
}

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
  assert.ok(beginStart !== -1 && beginEnd > beginStart, "begin 자리를 못 찾았다");
  const begin = workspace.slice(beginStart, beginEnd);
  // begin 은 이미 도는 업로드를 이어받는다. 여기서 다시 띄우면 두 번 올린다.
  assert.match(begin, /startPractice\(\{\s*upload: promise,/);
  assert.doesNotMatch(begin, /prepareVideoUpload\(|startVideoUpload\(/);

  // 완료 처리를 시작 확정까지 미루는 것(미리 하면 도중에 그만둔 영상이 만료
  // 스윕에 안 걸려 S3 에 남는다)은 practice-start 로 옮겨갔고,
  // tests/practice-start.test.mjs 가 실행으로 지킨다.

  // 연습을 떠나거나 영상을 바꾸면 올리던 것을 끊는다.
  // 되돌리는 길은 이어받기를 켜고 가는 것과 안 켜고 가는 것 둘이고, 둘 다 이 자리를 지난다.
  assert.match(workspace, /const resetTo = useCallback\(\(continueFrom: ContinueFrom \| null\) => \{\s*discardPendingUpload\(\)/);
  assert.match(workspace, /const resetToPrep = useCallback\(\(\) => resetTo\(null\)/);
  // 되돌아가는 이 자리가 뒤에서 도는 일도 함께 놓는다. 안 놓으면 늦게 오는 조회가
  // 자기 표시를 못 찾아 지우기 버튼이 잠긴 채 남는다. 무엇을 놓는지는
  // tests/use-workspace-busy.test.mjs 가 실행으로 지키고, 여기서는 이 자리가
  // 그것을 부르는지만 본다 — 창은 의존성 배열 앞에서 끊는다.
  const resetStart = workspace.indexOf("const resetTo = useCallback");
  const resetEnd = workspace.indexOf('replaceUrl("/practice/new")', resetStart);
  assert.ok(resetStart !== -1 && resetEnd > resetStart, "되돌아가는 자리를 못 찾았다");
  assert.match(workspace.slice(resetStart, resetEnd), /\n\s*clearWork\(\);/);
  const pickStart = workspace.indexOf("const onPickFile");
  const pickEnd = workspace.indexOf("const startUpload = useCallback", pickStart);
  assert.ok(pickStart !== -1 && pickEnd > pickStart, "영상 고르는 자리를 못 찾았다");
  assert.match(workspace.slice(pickStart, pickEnd), /discardPendingUpload\(\)/);
});

test("지우기가 끝난 자리는 그 연습이 아직 이 화면인지부터 묻는다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  // 지우는 동안에도 목록에서 다른 연습을 여는 길은 열려 있다. 그때 되돌리면 방금 연
  // 그 연습을 통째로 날린다. 무엇이 그 갈림을 정하는지는 tests/practice-removal.test.mjs
  // 가 실행으로 지키고, 여기서는 이 자리가 갈림마다 다르게 구는지만 본다 —
  // 창은 다음 선언 앞에서 끊는다.
  const removeStart = workspace.indexOf("const removeSession = useCallback");
  const removeEnd = workspace.indexOf("const noteBySession", removeStart);
  assert.ok(removeStart !== -1 && removeEnd > removeStart, "지우는 자리를 못 찾았다");
  const remove = workspace.slice(removeStart, removeEnd);
  assert.match(remove, /isCurrent: \(\) => isCurrentSession\(removing\),/);

  const removedAt = remove.indexOf('case "removed":');
  const supersededAt = remove.indexOf('case "removedSuperseded":');
  const failedAt = remove.indexOf('case "failed":');
  const failedSupersededAt = remove.indexOf('case "failedSuperseded":');
  assert.ok(
    removedAt !== -1 &&
      supersededAt > removedAt &&
      failedAt > supersededAt &&
      failedSupersededAt > failedAt,
    "지운 뒤의 갈림 넷을 못 찾았다",
  );
  // 갈림에 **닿기 전에** 되돌리면 묻는 시늉만 한 것이다 — 옛 버그가 정확히 그 모양이다.
  assert.doesNotMatch(remove.slice(0, removedAt), /resetToPrep\(\)/);
  // 아직 이 화면인 길에서만 되돌린다.
  assert.match(remove.slice(removedAt, supersededAt), /\n\s*resetToPrep\(\);/);
  // 자리를 뺏겼으면 목록만 갱신하고 화면은 건드리지 않는다.
  assert.doesNotMatch(remove.slice(supersededAt, failedAt), /resetToPrep\(\)/);
  // 못 지운 것도 남의 화면에는 띄우지 않는다.
  assert.doesNotMatch(remove.slice(failedSupersededAt), /setError/);
});

test("막힘 선택 완료 뒤에는 대화가 아니라 같은 진행 자리에서 기다린다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  assert.ok(beginStart !== -1 && beginEnd > beginStart, "begin 자리를 못 찾았다");
  const begin = workspace.slice(beginStart, beginEnd);

  // 그 전이가 무엇으로 가는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다 —
  // 여기서는 세션을 받은 자리와 폴링 사이 어디에 그것이 놓이는지를 본다.
  assert.match(
    begin,
    /startPractice\([\s\S]*dispatch\(\{ type: "sessionCreated", status: session\.status \}\)[\s\S]*trackAnalysis\(session\.session_id\)/,
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

test("코치가 붙기 전에는 입력이 비활성이고 붙으면 활성된다", () => {
  // 훑어보기가 안 끝났다는 조건은 여기서 빠졌다 — 그때는 대화 몸통 자체가 안 그려진다
  // (tests/workspace-view.test.mjs 의 "훑어보는 동안에는 대화 몸통 자체가 없다").
  assert.equal(isCoachInputEnabled({ coachReady: false, sending: false }), false);
  assert.equal(isCoachInputEnabled({ coachReady: true, sending: false }), true);
  // 보내는 중이면 코치가 붙어 있어도 닫힌다.
  assert.equal(isCoachInputEnabled({ coachReady: true, sending: true }), false);
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

test("막힌 대화를 처음부터 다시 열 때도 코치를 부르는 자리로 간다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const restart = between(
    workspace,
    "const restartAfterBlocked = useCallback",
    "const openSession = useCallback",
  );
  // 이 전이가 빠지면 화면은 노트에 남은 채 대화만 비워진다. 그 자리가 무엇을
  // 버리는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다.
  assert.match(restart, /dispatch\(\{ type: "coachStarting" \}\)/);
  assert.match(restart, /setMessages\(\[\]\)/);
});

test("두 진입 경로가 같은 자리에서 화면을 옮기고 같은 자리에서 결과를 적는다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  // 창을 deps 배열 앞에서 끊는다 — 삼키면 호출을 통째로 지워도 deps 에 남은 이름이
  // 단언을 통과시킨다. 아래에서 이름이 아니라 부르는 모양으로 겨누는 것도 같은 이유다.
  const byList = between(workspace, "const openSession = useCallback", "  }, [");
  const byUrl = between(
    workspace,
    "// 주소에 ?session= 이 실려 오면",
    "    return () => {",
  );

  // 조회 전 진입 구간은 지난 연습의 흔적을 걷어낸다. 이 전이가 빠지면 앞 연습의
  // "대화 마침"·훑어보기 실패 표시가 새로 연 화면에 그대로 남는다. 주소로 여는 길은
  // 첫 진입만 맡아 걷어낼 흔적이 없다. 무엇을 걷어내는지는
  // tests/workspace-state.test.mjs 가 실행으로 지킨다.
  const entry = between(byList, "const openSession = useCallback", "await loadPracticeSession");
  assert.match(entry, /dispatch\(\{ type: "sessionOpening" \}\)/);

  // 두 길 다 받아 온 연습을 같은 자리로 넘기고, 열어 본 결과도 같은 자리에 적는다.
  // 사본이 하나로 합쳐진 뒤로 이 배선이 그 합쳐짐 자체를 지킨다.
  assert.match(byList, /onLoaded: showLoadedSession,/, "목록: 화면 옮기기");
  assert.match(byList, /applyLoadOutcome\(result, id\)/, "목록: 결과 적기");
  assert.match(byUrl, /showLoadedSession\(loaded\)/, "주소: 화면 옮기기");
  assert.match(byUrl, /applyLoadOutcome\(result, sessionParam\)/, "주소: 결과 적기");

  // 두 길이 자리를 잡는 시점이 갈리므로 묻는 가드도 갈린다. 주소로 온 길은 조회가
  // 끝나야 자리를 잡아 그때까지 자리가 비어 있다 — isCurrent 로 물으면 자기 자신이
  // 걸러져 링크로 여는 경로가 통째로 죽는다(SOMA-414 가 고친 그 버그다). 무엇을
  // 통과시키는지는 tests/use-active-session.test.mjs 가 실행으로 지킨다.
  assert.match(byUrl, /cancelled \|\| !sessionIsCurrentOrFree\(sessionParam\)/, "주소: 빈 자리를 통과시키는 가드");
  assert.match(byList, /isCurrent: \(\) => isCurrentSession\(id\)/, "목록: 자리를 이미 잡고 들어온 가드");

  // 화면을 옮기는 그 한 자리가 실제로 이 전이를 싣는지. 어느 상태가 어느 화면으로
  // 가는지는 tests/workspace-state.test.mjs 가 실행으로 지킨다.
  const show = between(
    workspace,
    "const showLoadedSession = useCallback",
    "const applyLoadOutcome = useCallback",
  );
  assert.match(show, /dispatch\(\{ type: "sessionLoaded", status: loaded\.status \}\)/);
});

test("열어 본 결과가 어느 자리로 가는지는 한 곳에서 갈린다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  // 목록에서 여는 길과 주소로 여는 길이 이 하나를 공유한다. 무엇이 그 결과를 정하는지는
  // tests/session-loading.test.mjs 가, 각 전이가 화면을 어디로 옮기는지는
  // tests/workspace-state.test.mjs 가 실행으로 지킨다 — 여기서는 배선만 본다.
  const apply = between(
    workspace,
    "const applyLoadOutcome = useCallback",
    "const openSession = useCallback",
  );

  assert.match(between(apply, 'case "analyzing":', 'case "note":'), /trackAnalysis\(id\)/);

  // 가지를 각각 잘라 본다 — 한 창에 이어 놓으면 어느 가지에 무엇이 있는지 가리지
  // 못하고 등장 순서만 보게 된다. 노트 가지는 옛 코드의 try 경계를 그대로 들고 있어
  // 자기 안에서 한 번 더 갈린다.
  const noteFound = between(apply, 'case "note":', "} catch {");
  assert.match(noteFound, /dispatch\(\{ type: "noteLoaded", report: result\.report \}\)/);
  assert.match(noteFound, /countStepOnce\(id, "result"\)/);
  assert.doesNotMatch(noteFound, /report: null/);

  // 그 자리가 터지면 노트가 없는 것과 같은 길로 간다 — 옛 코드의 안쪽 catch 다.
  const noteFailed = between(apply, "} catch {", 'case "noNote":');
  assert.match(noteFailed, /dispatch\(\{ type: "noteLoaded", report: null \}\)/);
  assert.match(noteFailed, /startConversationAfterAnalysis\(id\)/);
  assert.doesNotMatch(noteFailed, /result\.report/);

  const noNote = between(apply, 'case "noNote":', 'case "analysisFailed":');
  assert.match(noNote, /dispatch\(\{ type: "noteLoaded", report: null \}\)/);
  assert.match(noNote, /startConversationAfterAnalysis\(id\)/);
  assert.doesNotMatch(noNote, /result\.report/);

  // 훑어보기가 실패한 연습과 자리를 뺏긴 응답은 나란히 아무것도 하지 않는다.
  assert.match(apply, /case "analysisFailed":\s*case "superseded":\s*return;/);
});
