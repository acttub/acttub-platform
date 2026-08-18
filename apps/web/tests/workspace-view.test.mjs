// 연습 화면이 지금 무엇을 그리는지 고정하는 특성화 테스트.
// 해체(SOMA-409) 전의 행동을 그대로 못박는 것이 목적이라, 이상해 보이는 자리도
// 이상한 채로 적어 둔다 — 고치는 것은 뒤 커밋의 일이고, 여기서 바뀌면 그건 사고다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { describeWorkspaceView } = await import(
  "../src/features/workspace/workspace-view.ts"
);

/** 아무것도 안 한 첫 화면. 각 테스트는 필요한 것만 덮어쓴다. */
const base = {
  mode: "prep",
  videoFile: null,
  videoUrl: null,
  playbackUrl: null,
  analysisStatus: null,
  coachDone: false,
  reportType: null,
  continueFrom: null,
};

const view = (overrides) => describeWorkspaceView({ ...base, ...overrides });

test("영상을 고르기 전 준비 화면은 첫 준비 순서에 서고 업로드 자리를 보여 준다", () => {
  const { body, statusChip, review } = view({});
  assert.equal(body.kind, "setup");
  assert.equal(body.step, 1);
  assert.equal(body.sceneLocked, false);
  assert.deepEqual(body.video, { kind: "upload-zone" });
  assert.deepEqual(body.footer, { kind: "start", ready: false });
  assert.equal(body.continueBanner, null);
  assert.equal(statusChip, null);
  assert.deepEqual(review, { armed: false, kind: "chat" });
});

test("영상을 고르면 준비 순서가 다음으로 올라가고 시작 버튼이 열린다", () => {
  const { body } = view({
    videoFile: { name: "monologue.mp4" },
    videoUrl: "blob:local",
  });
  assert.equal(body.step, 2);
  assert.deepEqual(body.video, {
    kind: "player",
    src: "blob:local",
    caption: "monologue.mp4",
    reselectable: true,
  });
  assert.deepEqual(body.footer, { kind: "start", ready: true });
});

test("업로드 중에는 준비 순서가 마지막에서 잠기고 영상 설명이 바뀌며 다시 고를 수 없다", () => {
  const { body, statusChip } = view({
    mode: "uploading",
    videoFile: { name: "monologue.mp4" },
    videoUrl: "blob:local",
  });
  assert.equal(body.step, 3);
  assert.equal(body.sceneLocked, true);
  assert.deepEqual(body.video, {
    kind: "player",
    src: "blob:local",
    caption: "업로드 중에도 영상은 볼 수 있어요",
    reselectable: false,
  });
  assert.deepEqual(body.footer, { kind: "progress", phase: "upload" });
  assert.equal(statusChip, "uploading");
});

test("분석 중에는 훑어보는 막대가 서고 상태 칩은 질문 준비다", () => {
  const { body, statusChip } = view({
    mode: "preparing",
    analysisStatus: "analyzing",
    playbackUrl: "https://cdn/one.mp4",
  });
  assert.equal(body.step, 3);
  assert.deepEqual(body.footer, { kind: "progress", phase: "scan", failed: false });
  assert.equal(statusChip, "preparing");
});

test("분석이 실패해도 화면은 여전히 분석 화면이고 막대만 실패로 바뀐다", () => {
  // 이름 없는 상태다 — "failed" 모드가 존재하지 않아 분석 화면이 실패 화면을 겸한다.
  const { body, statusChip } = view({ mode: "preparing", analysisStatus: "failed" });
  assert.deepEqual(body.footer, { kind: "progress", phase: "scan", failed: true });
  assert.equal(statusChip, "preparing");
});

test("목록에서 연 세션은 로컬 원본이 없어 서버 영상을 기본 설명으로 튼다", () => {
  const { body } = view({
    mode: "preparing",
    analysisStatus: "analyzing",
    playbackUrl: "https://cdn/one.mp4",
  });
  assert.deepEqual(body.video, {
    kind: "player",
    src: "https://cdn/one.mp4",
    caption: "올린 영상",
    reselectable: false,
  });
});

test("빈 영상 주소는 주소가 없는 것과 같이 다룬다", () => {
  // 옛 코드의 `visibleVideoUrl ?` 가 빈 문자열을 걸러 냈다. 같은 판정을 유지한다.
  assert.deepEqual(view({ videoUrl: "" }).body.video, { kind: "upload-zone" });
  assert.deepEqual(view({ mode: "preparing", playbackUrl: "" }).body.video, {
    kind: "none",
  });
});

test("로컬 원본이 있으면 서버 주소보다 그것을 먼저 튼다", () => {
  const { body } = view({
    mode: "preparing",
    videoFile: { name: "monologue.mp4" },
    videoUrl: "blob:local",
    playbackUrl: "https://cdn/one.mp4",
  });
  assert.equal(body.video.src, "blob:local");
});

test("막힘 선택은 영상이 있을 때만 선다", () => {
  const { body, statusChip } = view({
    mode: "blockage",
    videoFile: { name: "monologue.mp4" },
    videoUrl: "blob:local",
  });
  assert.deepEqual(body, { kind: "blockage", videoUrl: "blob:local" });
  assert.equal(statusChip, null);
});

test("막힘 상태인데 영상이 없으면 준비 화면으로 흘러내린다", () => {
  // 도달 가능한 잘못된 조합이다. 준비 화면이 그려지고 시작 버튼까지 다시 뜬다.
  const { body, statusChip } = view({
    mode: "blockage",
    videoFile: { name: "monologue.mp4" },
    videoUrl: null,
  });
  assert.equal(body.kind, "setup");
  assert.deepEqual(body.video, { kind: "none" });
  assert.deepEqual(body.footer, { kind: "start", ready: true });
  assert.equal(statusChip, null);
});

test("대화 중에는 대화가 화면을 이끈다", () => {
  const { body, statusChip, review } = view({ mode: "chat" });
  assert.deepEqual(body, { kind: "chat", done: false, noteReady: false });
  assert.equal(statusChip, "chat");
  assert.deepEqual(review, { armed: true, kind: "chat" });
});

test("대화가 끝나면 화면은 그대로인 채 상태 칩만 대화 마침으로 바뀐다", () => {
  const { body, statusChip } = view({ mode: "chat", coachDone: true });
  assert.equal(body.kind, "chat");
  assert.equal(body.done, true);
  assert.equal(statusChip, "chat-done");
});

test("노트를 받아 두면 대화 화면에서 노트로 넘어갈 길이 열린다", () => {
  const { body } = view({ mode: "chat", coachDone: true, reportType: "analysis" });
  assert.equal(body.noteReady, true);
});

test("연습 노트 화면은 대화로 돌아가는 길을 준다", () => {
  const { body, statusChip, review } = view({
    mode: "note",
    reportType: "expression",
  });
  assert.deepEqual(body, { kind: "note", backTo: "chat" });
  assert.equal(statusChip, "note");
  assert.deepEqual(review, { armed: true, kind: "note" });
});

test("막힌 대화의 노트는 돌아갈 대화가 없어 처음부터 다시 연다", () => {
  const { body } = view({ mode: "note", reportType: "blocked" });
  assert.equal(body.backTo, "restart");
});

test("노트가 없는 노트 화면도 도달 가능하고 대화로 돌아가는 길만 남는다", () => {
  const { body } = view({ mode: "note", reportType: null });
  assert.deepEqual(body, { kind: "note", backTo: "chat" });
});

test("이어받기 배너는 준비 화면에서만 해제할 수 있다", () => {
  const continueFrom = { id: "s-1", label: "면접 장면" };
  assert.deepEqual(view({ continueFrom }).body.continueBanner, {
    label: "면접 장면",
    dismissible: true,
  });
  assert.deepEqual(view({ mode: "uploading", continueFrom }).body.continueBanner, {
    label: "면접 장면",
    dismissible: false,
  });
  assert.deepEqual(view({ mode: "preparing", continueFrom }).body.continueBanner, {
    label: "면접 장면",
    dismissible: false,
  });
});

test("이름이 없는 지난 연습은 배너에 이름 없이 뜬다", () => {
  const { body } = view({ continueFrom: { id: "s-1", label: null } });
  assert.deepEqual(body.continueBanner, { label: null, dismissible: true });
});

test("막힘을 고르는 동안에는 이어받기 배너가 아예 사라진다", () => {
  // 배너는 준비 계열 화면에만 그려진다 — 막힘 선택으로 넘어가면 표시가 통째로 없다.
  const { body } = view({
    mode: "blockage",
    videoFile: { name: "monologue.mp4" },
    videoUrl: "blob:local",
    continueFrom: { id: "s-1", label: "면접 장면" },
  });
  assert.equal(body.kind, "blockage");
  assert.equal("continueBanner" in body, false);
});

test("대화·노트 화면에서는 이어받기 표시가 화면에서 사라진다", () => {
  const continueFrom = { id: "s-1", label: "면접 장면" };
  assert.equal("continueBanner" in view({ mode: "chat", continueFrom }).body, false);
  assert.equal("continueBanner" in view({ mode: "note", continueFrom }).body, false);
});
