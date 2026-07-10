import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const flow = read("src/features/practice/practice-flow.tsx");
const client = read("src/lib/api/practice.ts");
const types = read("src/lib/api/types.ts");

test("browser authority is limited to exact platform DTOs and same-origin v1 clients", () => {
  assert.match(flow, /createPracticeUploadIntent\(\{[\s\S]*fileMetadata: \{[\s\S]*fileName: selectedFile\.name,[\s\S]*mimeType:[\s\S]*sizeBytes: selectedFile\.size,[\s\S]*adultConfirmed: true,[\s\S]*allParticipantsConfirmed: true/);
  assert.match(flow, /createPipelinePracticeSession\(\{[\s\S]*sessionId: uploadIntent\.sessionId,[\s\S]*uploadIntentId: uploadIntent\.uploadIntentId,[\s\S]*storagePath: finalizedUpload\.storagePath,[\s\S]*genre,[\s\S]*situation,[\s\S]*characterContext/);
  assert.doesNotMatch(flow.slice(flow.indexOf("createPipelinePracticeSession"), flow.indexOf("setPipelineSessionReady")), /videoUrl|durationMs|medium|fileMetadata/);
  assert.match(types, /confidence: null;/);
  assert.match(types, /correctionByTurnId: string;/);
  assert.doesNotMatch(client + flow, /generativelanguage|googleapis|gemini|\/summar(?:y|ies)|python|localhost:|127\.0\.0\.1/i);
  for (const match of client.matchAll(/fetch\((?:`|")([^`"]+)/g)) assert.ok(match[1].startsWith("/api/v1/"), match[1]);
});

test("consent and upload eligibility remain explicit and fail closed", () => {
  const gate = read("src/features/practice/terms-gate.tsx");
  assert.match(gate, /useState\(false\)[\s\S]*useState\(false\)[\s\S]*useState\(false\)/);
  assert.match(gate, /!serviceConsent \|\| !aiProcessingConsent/);
  assert.match(gate, /internalReviewConsent,/);
  assert.match(gate, /선택 · 기본 꺼짐/);
  assert.match(flow, /!adultConfirmed \|\| !allParticipantsConfirmed/);
  assert.match(flow, /disabled=\{submitting \|\| !uploadFile \|\| !adultConfirmed \|\| !allParticipantsConfirmed\}/);
});

test("candidate and interview state are sequential, provenance-aware and server persisted", () => {
  assert.match(flow, /observations\.slice\(0, 3\)/);
  assert.match(flow, /find\(\(item\) => item\.confirmationState === "unasked"\)/);
  assert.match(flow, /state === declinedObservationState[\s\S]*correction: correction\.trim\(\)/);
  assert.match(flow, /onUnknown=\{\(\) => submitPipelineAnswer\("모르겠어요"\)\}/);
  assert.match(flow, /appendPipelineInterviewTurn\([\s\S]*answer: trimmed,[\s\S]*expectedSubstantiveAnswerCount: pipelineSession\.substantiveAnswerCount/);
  for (const action of ["startPipelineInterview", "stopPipelineInterview", "resumePipelineInterview"]) assert.match(flow, new RegExp(action));
  assert.match(flow, /MIN_DIALOGUE_ANSWER_COUNT/);
  assert.match(flow, /substantiveAnswerCount >= MAX_DIALOGUE_ANSWER_COUNT/);
  assert.match(flow, /completed && !accepted/);
  assert.match(flow, /session\.report && accepted/);
  assert.match(flow, /getPipelinePracticeSession\(sessionId\)[\s\S]*setPipelineSession\(result\.session\)/);
});

test("immutable detail, private playback and lifecycle controls stay fail closed", () => {
  const detail = read("src/features/practice/pipeline/session-detail.tsx");
  const report = read("src/features/practice/pipeline/report-view.tsx");
  const video = read("src/features/practice/pipeline/private-video.tsx");
  const eslint = read("eslint.config.mjs");
  assert.equal((report.match(/^  \["(?:oneLineSummary|primaryReviewPoint|confirmedEvidence|actorDiscovery|groundedEncouragement|nextPracticeStep)"/gm) ?? []).length, 6);
  assert.match(report, /section\.status === "not_confirmed" \|\| section\.content === null \? REPORT_FALLBACK/);
  assert.match(detail, /getPipelinePracticeSession\(sessionId\)/);
  assert.match(video, /createPracticeSignedVideoUrl\(sessionId\)/);
  assert.match(video, /currentTime = startMs \/ 1000/);
  assert.doesNotMatch(video, /localStorage|sessionStorage|storagePath|clip/i);
  assert.match(flow, /hidden: !session\.hiddenAt/);
  assert.match(flow, /deletionRequestIdRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(flow, /getPipelineDeletionStatus\(session\.id, requestId\)/);
  assert.match(flow, /pipelineVersion === "ai-pipeline\.v1" \? \([\s\S]*<Link/);
  assert.doesNotMatch(eslint, /no-html-link|@next\/next\/no-html-link/);
});
