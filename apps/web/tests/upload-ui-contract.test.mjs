import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const appRoot = path.resolve(import.meta.dirname, "..");
const practiceSingle = readFileSync(
  path.join(appRoot, "src/features/practice/practice-single.tsx"),
  "utf8",
);
const practiceFlow = readFileSync(
  path.join(appRoot, "src/features/practice/practice-flow.tsx"),
  "utf8",
);

test("PracticeSingle은 공통 preflight와 압축·업로드 진행률, abort를 연결한다", () => {
  assert.match(practiceSingle, /prepareVideoUpload\(videoFile/);
  assert.match(practiceSingle, /onCompressionProgress/);
  assert.match(practiceSingle, /onProgress/);
  assert.match(practiceSingle, /new AbortController\(\)/);
  assert.doesNotMatch(practiceSingle, /durationMsRef/);
  assert.doesNotMatch(practiceSingle, /서버 처리 30~120초/);
  assert.ok(
    (practiceSingle.match(/uploadControllerRef\.current === controller/g) ?? [])
      .length >= 2,
  );
});

test("PracticeFlow.begin도 공통 preflight를 사용하고 이전 제한 카피를 남기지 않는다", () => {
  assert.match(practiceFlow, /prepareVideoUpload\(file/);
  assert.match(practiceFlow, /onCompressionProgress/);
  assert.doesNotMatch(practiceFlow, /550MB/);
  assert.doesNotMatch(practiceFlow, /3분 이하여야 해요/);
  assert.match(practiceFlow, /MP4 · MOV · 5분 이내/);
  assert.ok(
    (practiceFlow.match(/uploadControllerRef\.current === controller/g) ?? [])
      .length >= 2,
  );
});

test("PracticeFlow 리포트는 연습 세션으로 연결하고 결과와 영상만 보여 준다", () => {
  assert.doesNotMatch(practiceFlow, /practiceCoachSessionMap/);
  assert.doesNotMatch(practiceFlow, /normalizeReportTurns/);
  assert.doesNotMatch(practiceFlow, /reportTurnsForStorage/);
  assert.doesNotMatch(practiceFlow, /완료된 AI 코칭 대화/);
  assert.match(
    practiceFlow,
    /record\.practice_session_id === practiceSessionId/,
  );
  assert.match(
    practiceFlow,
    /<video key=\{playbackUrl\} controls preload="metadata" src=\{playbackUrl\} onError=\{onPlaybackError\}/,
  );
  assert.match(practiceFlow, /practice_session_id: active\.sessionId/);
});
