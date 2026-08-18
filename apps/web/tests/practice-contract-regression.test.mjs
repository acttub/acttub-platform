import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const readWeb = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), "utf8");
const readRepo = (relativePath) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const { buildPracticeSessionRequest } = await import(
  "../src/features/practice/practice-setup-flow.ts"
);

test("세션 생성 본문은 goal을 포함하고 subtext를 포함하지 않는다", () => {
  const body = buildPracticeSessionRequest(
    "upload-intent-1",
    {
      situation: " 이별을 통보받은 직후, 카페에서 ",
      characterContext: " 담담한 척하는 20대 후반 여성 ",
      goal: " 상대가 마음을 돌려 다시 앉게 만들기 ",
    },
    { blockage_kind: "표현", sub_branch: "표정" },
  );

  assert.equal(body.goal, "상대가 마음을 돌려 다시 앉게 만들기");
  assert.equal(Object.hasOwn(body, "subtext"), false);
});

test("막힘 선택 완료 뒤 질문 재료가 준비될 때까지 진행 화면에 머문다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const beginStart = workspace.indexOf("const begin = useCallback");
  const beginEnd = workspace.indexOf("const send = useCallback", beginStart);
  const begin = workspace.slice(beginStart, beginEnd);

  assert.match(
    begin,
    /createPracticeSession[\s\S]*dispatch\(\{ type: "sessionCreated", status: session\.status \}\)[\s\S]*trackAnalysis\(session\.session_id\)/,
  );
  assert.doesNotMatch(begin, /type: "coachStarting"|startCoach\(/);
});

test("질문 준비는 기존 진행 자리에서 장면을 훑는다고 안내한다", () => {
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");
  const panelStart = workspace.indexOf("function ProgressPanel");
  const panelEnd = workspace.indexOf("function IntroLine", panelStart);
  const progressPanel = workspace.slice(panelStart, panelEnd);

  assert.match(progressPanel, /장면을 훑어보고 있어요/);
  assert.doesNotMatch(progressPanel, /분석 중|평가 중/);
});

test("코치 응답을 기다리는 동안 7px 세 점 표시가 렌더된다", () => {
  const component = readWeb("src/features/practice/waiting-dots.tsx");
  const styles = readWeb("src/app/globals.css");
  const workspace = readWeb("src/features/workspace/workspace-app.tsx");

  assert.equal((component.match(/<i \/>/g) ?? []).length, 3);
  assert.match(styles, /\.waiting-dots i \{[\s\S]*width: 7px;[\s\S]*height: 7px;/);
  assert.match(styles, /animation: waiting-dot-pulse 1\.2s/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.waiting-dots i[\s\S]*animation: none/);
  assert.match(workspace, /sending \? \([\s\S]*<WaitingDots \/>/);
});

test("이번 변경에서 다룬 화면 카피에는 금지어가 없다", () => {
  const sources = [
    readWeb("src/features/workspace/workspace-app.tsx"),
    readWeb("src/features/practice/waiting-dots.tsx"),
    readRepo("apps/mobile/app/upload.tsx"),
    readRepo("apps/mobile/app/coach.tsx"),
  ];
  const userFacingCopy = sources.flatMap((source) => [
    ...[...source.matchAll(/>([^<>{}\n]*[가-힣][^<>{}\n]*)</g)].map((match) => match[1]),
    ...[...source.matchAll(/\b(?:placeholder|aria-label|title|alt)=["']([^"']+)["']/g)]
      .map((match) => match[1]),
  ]).join("\n");
  const forbidden = [
    /리포트|점수|등급|강점|약점|진정성|몰입도|피드백 카드|처방/,
    /\b(?:report|score|grade|strength|weakness|authenticity|immersion|feedback card|prescription)\b/i,
  ];

  for (const pattern of forbidden) assert.doesNotMatch(userFacingCopy, pattern);
});
