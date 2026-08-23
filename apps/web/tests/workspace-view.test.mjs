// 연습 화면이 지금 무엇을 그리는지 고정하는 특성화 테스트.
// 해체(SOMA-409) 전의 행동을 그대로 못박는 것이 목적이라, 이상해 보이는 자리도
// 이상한 채로 적어 둔다 — 고치는 것은 뒤 커밋의 일이고, 여기서 바뀌면 그건 사고다.
// 어느 화면인지와 그 화면이 무엇을 드는지는 workspace-state.test.mjs 가 따로 지킨다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { describeWorkspaceView } = await import(
  "../src/features/workspace/workspace-view.ts"
);

/** 배우가 고른 로컬 원본. */
const picked = (name = "monologue.mp4", url = "blob:local") => ({
  file: new File(["take"], name, { type: "video/mp4" }),
  url,
});
const CONTINUE = { id: "s-1", label: "면접 장면" };
/** 코치가 준 연습 노트. 여기서 갈리는 것은 종류 하나뿐이다. */
const NOTE = { report_type: "analysis" };
const BLOCKED_NOTE = { report_type: "blocked" };

/** 아무것도 적지 않은 Scene Context. 세 칸이 다 비면 건너뛰기가 열린다. */
const BLANK_SCENE = { situation: "", characterContext: "", goal: "" };

/** 아무것도 안 한 첫 화면. 각 테스트는 필요한 것만 덮어쓴다. */
const base = {
  screen: { kind: "prep", video: null, continueFrom: null },
  playbackUrl: null,
  scene: BLANK_SCENE,
};

const view = (overrides) => describeWorkspaceView({ ...base, ...overrides });
/** 화면만 갈아끼울 때 쓰는 손잡이. */
const at = (screen, overrides = {}) => view({ screen, ...overrides });

test("영상을 고르기 전 준비 화면은 첫 준비 순서에 서고 업로드 자리를 보여 준다", () => {
  const { body, statusChip, review } = view({});
  assert.equal(body.kind, "setup");
  assert.equal(body.step, 1);
  assert.equal(body.sceneLocked, false);
  assert.deepEqual(body.video, { kind: "upload-zone" });
  // 올릴 영상이 없으면 건너뛸 것도 없다.
  assert.deepEqual(body.footer, { kind: "start", ready: false, skippable: false });
  assert.equal(body.continueBanner, null);
  assert.equal(statusChip, null);
  assert.deepEqual(review, { armed: false, kind: "chat" });
});

test("영상을 고르면 준비 순서가 다음으로 올라가고 시작 버튼이 열린다", () => {
  const { body } = at({ kind: "prep", video: picked(), continueFrom: null });
  assert.equal(body.step, 2);
  assert.deepEqual(body.video, {
    kind: "player",
    src: "blob:local",
    caption: "monologue.mp4",
    reselectable: true,
  });
  assert.deepEqual(body.footer, { kind: "start", ready: true, skippable: true });
});

test("장면 세 칸이 모두 비어야 건너뛰기가 열린다", () => {
  const screen = { kind: "prep", video: picked(), continueFrom: null };
  const footer = (scene) => view({ screen, scene }).body.footer;

  // 한 칸이라도 적었으면 감춘다 — 적어 둔 것이 말없이 버려질 걱정을 하지 않아야 한다.
  assert.equal(footer({ ...BLANK_SCENE, situation: "카페에서" }).skippable, false);
  assert.equal(footer({ ...BLANK_SCENE, characterContext: "20대 여성" }).skippable, false);
  assert.equal(footer({ ...BLANK_SCENE, goal: "붙잡기" }).skippable, false);
  // 공백만 적은 것은 비운 것과 같다. 요청 조립이 그것을 trim 해 빈 값으로 보낸다.
  assert.equal(footer({ situation: " ", characterContext: "\n", goal: "\t" }).skippable, true);
});

test("업로드 중에는 준비 순서가 마지막에서 잠기고 영상 설명이 바뀌며 다시 고를 수 없다", () => {
  const { body, statusChip } = at({
    kind: "uploading",
    video: picked(),
    continueFrom: null,
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

test("훑어보는 동안에는 막대가 서고 상태 칩은 질문 준비다", () => {
  const { body, statusChip } = at({ kind: "analyzing", video: null }, {
    playbackUrl: "https://cdn/one.mp4",
  });
  assert.equal(body.step, 3);
  assert.deepEqual(body.footer, { kind: "progress", phase: "scan", failed: false });
  assert.equal(statusChip, "analyzing");
});

test("훑어보기가 실패해도 화면은 같은 자리에 남고 막대만 실패로 바뀐다", () => {
  // 이제 이름이 있는 상태다. 이름만 갈렸을 뿐 그리는 것은 그대로여야 한다.
  const { body, statusChip } = at({ kind: "analysisFailed", video: null });
  assert.equal(body.kind, "setup");
  assert.equal(body.step, 3);
  assert.equal(body.sceneLocked, true);
  assert.deepEqual(body.footer, { kind: "progress", phase: "scan", failed: true });
  assert.equal(statusChip, "analyzing");
});

test("목록에서 연 세션은 로컬 원본이 없어 서버 영상을 기본 설명으로 튼다", () => {
  const { body } = at({ kind: "analyzing", video: null }, {
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
  // 옛 코드의 `visibleVideoUrl ?` 가 빈 문자열을 걸러 냈다. 같은 규칙을 유지한다.
  assert.deepEqual(
    at({ kind: "prep", video: picked("monologue.mp4", ""), continueFrom: null }).body
      .video,
    { kind: "upload-zone" },
  );
  assert.deepEqual(
    at({ kind: "analyzing", video: null }, { playbackUrl: "" }).body.video,
    { kind: "none" },
  );
});

test("로컬 원본이 있으면 서버 주소보다 그것을 먼저 튼다", () => {
  const { body } = at({ kind: "analyzing", video: picked() }, {
    playbackUrl: "https://cdn/one.mp4",
  });
  assert.equal(body.video.src, "blob:local");
  assert.equal(body.video.caption, "monologue.mp4");
});

test("영상을 골랐어도 훑어보는 중이면 준비 순서는 마지막에 잠긴다", () => {
  // 시작한 뒤에는 고른 영상이 준비 순서를 되돌리지 않는다.
  const { body } = at({ kind: "analyzing", video: picked() });
  assert.equal(body.step, 3);
  assert.equal(body.sceneLocked, true);
  assert.equal(body.video.reselectable, false);
});

test("막힘 선택은 자기 영상을 들고 선다", () => {
  const { body, statusChip } = at({
    kind: "blockage",
    video: picked(),
    continueFrom: null,
  });
  assert.deepEqual(body, { kind: "blockage", videoUrl: "blob:local" });
  assert.equal(statusChip, null);
});

test("대화 중에는 대화가 화면을 이끈다", () => {
  const { body, statusChip, review } = at({
    kind: "chat",
    coachId: "coach-1",
    report: null,
  });
  assert.deepEqual(body, {
    kind: "chat",
    done: false,
    noteReady: false,
    coachReady: true,
  });
  assert.equal(statusChip, "chat");
  assert.deepEqual(review, { armed: true, kind: "chat" });
});

test("빈 코치 id 는 코치가 없는 것과 같이 다룬다", () => {
  // 옛 가드가 `&& coachSessionId` 로 빈 문자열을 걸렀다. 그것으로는 답을 보낼 수 없다.
  assert.equal(
    at({ kind: "chat", coachId: "", report: null }).body.coachReady,
    false,
  );
});

test("코치를 기다리는 동안에도 화면은 대화이고 입력만 잠긴다", () => {
  const { body, statusChip, review } = at({ kind: "chatOpening", report: null });
  assert.deepEqual(body, {
    kind: "chat",
    done: false,
    noteReady: false,
    coachReady: false,
  });
  assert.equal(statusChip, "chat");
  assert.deepEqual(review, { armed: true, kind: "chat" });
});

test("훑어보는 동안에는 대화 몸통 자체가 없다", () => {
  // 입력이 열려 있는지는 대화 몸통이 그려진 뒤에나 물을 수 있다 — 훑어보기가
  // 끝나기 전에 답을 보낼 수 없는 것은 이 분기가 지킨다.
  for (const screen of [
    { kind: "analyzing", video: null },
    { kind: "analysisFailed", video: null },
  ]) {
    assert.equal(at(screen).body.kind, "setup");
  }
});

test("대화가 끝나면 화면은 그대로인 채 상태 칩만 대화 마침으로 바뀐다", () => {
  const { body, statusChip, review } = at({
    kind: "chatDone",
    coachId: "coach-1",
    report: NOTE,
  });
  assert.equal(body.kind, "chat");
  assert.equal(body.done, true);
  assert.equal(statusChip, "chat-done");
  assert.deepEqual(review, { armed: true, kind: "chat" });
});

test("노트를 받아 두면 대화 화면에서 노트로 넘어갈 길이 열린다", () => {
  assert.equal(
    at({ kind: "chatDone", coachId: "coach-1", report: NOTE }).body.noteReady,
    true,
  );
  // 코치를 기다리는 자리에 들고 온 노트도 그 길을 연다 — 지난 연습을 여는 사이다.
  assert.equal(at({ kind: "chatOpening", report: NOTE }).body.noteReady, true);
});

test("연습 노트 화면은 자기 노트를 들고 대화로 돌아가는 길을 준다", () => {
  const priorChat = { coachId: "coach-1", done: true };
  const { body, statusChip, review } = at({ kind: "note", report: NOTE, priorChat });
  assert.deepEqual(body, { kind: "note", report: NOTE, backTo: "chat" });
  assert.equal(statusChip, "note");
  assert.deepEqual(review, { armed: true, kind: "note" });
});

test("막힌 대화의 노트는 돌아갈 대화가 없어 처음부터 다시 연다", () => {
  const { body } = at({
    kind: "note",
    report: BLOCKED_NOTE,
    priorChat: { coachId: "coach-1", done: true },
  });
  assert.equal(body.backTo, "restart");
});

test("돌아갈 대화가 있고 없고는 노트 화면이 그리는 것을 가르지 않는다", () => {
  // 그 값은 대화로 돌아갈 때 어디에 서는지만 정한다(workspace-state.test.mjs).
  assert.deepEqual(
    at({ kind: "note", report: NOTE, priorChat: { coachId: "coach-1", done: true } }),
    at({ kind: "note", report: NOTE, priorChat: null }),
  );
});

test("이어받기 배너는 준비 화면에서만 해제할 수 있다", () => {
  assert.deepEqual(
    at({ kind: "prep", video: null, continueFrom: CONTINUE }).body.continueBanner,
    { label: "면접 장면", dismissible: true },
  );
  assert.deepEqual(
    at({ kind: "uploading", video: picked(), continueFrom: CONTINUE }).body
      .continueBanner,
    { label: "면접 장면", dismissible: false },
  );
});

test("이름이 없는 지난 연습은 배너에 이름 없이 뜬다", () => {
  const { body } = at({
    kind: "prep",
    video: null,
    continueFrom: { id: "s-1", label: null },
  });
  assert.deepEqual(body.continueBanner, { label: null, dismissible: true });
});

test("훑어보기 자리에는 이어받기 표시가 남지 않는다", () => {
  // 그 표시는 세션을 만드는 요청에 실려 가면서 할 일을 마친다.
  assert.equal(at({ kind: "analyzing", video: picked() }).body.continueBanner, null);
  assert.equal(at({ kind: "analysisFailed", video: null }).body.continueBanner, null);
});

test("막힘을 고르는 동안에는 이어받기 배너가 아예 사라진다", () => {
  // 배너는 준비 계열 화면에만 그려진다 — 막힘 선택으로 넘어가면 표시가 통째로 없다.
  const { body } = at({ kind: "blockage", video: picked(), continueFrom: CONTINUE });
  assert.equal(body.kind, "blockage");
  assert.equal("continueBanner" in body, false);
});

test("대화·노트 화면에서는 이어받기 표시가 화면에서 사라진다", () => {
  for (const screen of [
    { kind: "chatOpening", report: null },
    { kind: "chat", coachId: "coach-1", report: null },
    { kind: "chatDone", coachId: "coach-1", report: NOTE },
    { kind: "note", report: NOTE, priorChat: null },
  ]) {
    assert.equal(
      "continueBanner" in at(screen).body,
      false,
      `${screen.kind} 에 이어받기 표시가 남았다`,
    );
  }
});
