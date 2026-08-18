// 연습 화면이 무슨 일에 어떻게 옮겨 가는지 고정하는 전이표 테스트.
// 해체(SOMA-409) 전의 행동을 그대로 못박는 것이 목적이다 — 옮기기 전에는
// mode(6) 에 coachDone 과 analysisStatus === "failed" 가 곱해져 정해지던 것들이고,
// 곱을 하나로 합치면서 흘린 것이 있으면 여기서 빨간불이 켜져야 한다.
// 그 화면이 무엇을 그리는지는 workspace-view.test.mjs 가 따로 지킨다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { abandonedStage, initialWorkspaceScreen, workspaceScreenReducer } =
  await import("../src/features/workspace/workspace-state.ts");

/** 도달 가능한 화면 전부. "어느 자리에서 와도" 를 물을 때 쓴다. */
const EVERY_SCREEN = [
  { kind: "prep" },
  { kind: "blockage" },
  { kind: "uploading" },
  { kind: "analyzing" },
  { kind: "analysisFailed" },
  { kind: "chat" },
  { kind: "chatDone" },
  { kind: "note", coachDone: true },
  { kind: "note", coachDone: false },
];

const advance = (screen, action) => workspaceScreenReducer(screen, action);

test("첫 화면은 준비 화면이다", () => {
  assert.deepEqual(initialWorkspaceScreen, { kind: "prep" });
});

test("새 연습으로 되돌리면 어느 자리에서 왔든 준비 화면에 선다", () => {
  for (const screen of EVERY_SCREEN) {
    assert.deepEqual(advance(screen, { type: "reset" }), { kind: "prep" });
  }
});

test("질문 받기를 누르면 막힘 선택으로, 다 고르면 업로드로 간다", () => {
  const blockage = advance({ kind: "prep" }, { type: "blockageChosen" });
  assert.deepEqual(blockage, { kind: "blockage" });
  assert.deepEqual(advance(blockage, { type: "uploadStarted" }), { kind: "uploading" });
});

test("올리다 실패하면 준비 화면으로 돌아간다", () => {
  assert.deepEqual(advance({ kind: "uploading" }, { type: "uploadFailed" }), {
    kind: "prep",
  });
});

test("세션이 만들어지면 훑어보는 자리로 가고, 곧바로 실패로 와도 대화로 가지 않는다", () => {
  const uploading = { kind: "uploading" };
  for (const status of ["created", "analyzing", "analyzed"]) {
    assert.deepEqual(advance(uploading, { type: "sessionCreated", status }), {
      kind: "analyzing",
    });
  }
  assert.deepEqual(advance(uploading, { type: "sessionCreated", status: "failed" }), {
    kind: "analysisFailed",
  });
});

test("훑어보기가 실패하면 같은 자리에 이름만 갈려서 남는다", () => {
  assert.deepEqual(
    advance({ kind: "analyzing" }, { type: "analysisStatusReported", status: "failed" }),
    { kind: "analysisFailed" },
  );
  assert.deepEqual(
    advance({ kind: "analyzing" }, { type: "analysisStatusReported", status: "analyzed" }),
    { kind: "analyzing" },
  );
});

test("훑어보기 자리를 떠난 뒤 도착한 상태는 화면을 되돌리지 않는다", () => {
  // 근거 없이 대화를 시작한 사람을 뒤늦게 온 폴링이 진행 자리로 끌어오면 안 된다.
  for (const screen of EVERY_SCREEN) {
    if (screen.kind === "analyzing" || screen.kind === "analysisFailed") continue;
    for (const status of ["analyzed", "failed", "analyzing"]) {
      assert.deepEqual(
        advance(screen, { type: "analysisStatusReported", status }),
        screen,
        `${screen.kind} 이 ${status} 에 움직였다`,
      );
    }
  }
});

test("다른 연습을 여는 중에는 지난 연습의 흔적만 걷어낸다", () => {
  // 무엇을 열었는지는 아직 모른다. 화면을 옮기지 않고, 앞 연습이 남긴 표시만 지운다.
  assert.deepEqual(advance({ kind: "chatDone" }, { type: "sessionOpening" }), {
    kind: "chat",
  });
  assert.deepEqual(advance({ kind: "analysisFailed" }, { type: "sessionOpening" }), {
    kind: "analyzing",
  });
  assert.deepEqual(
    advance({ kind: "note", coachDone: true }, { type: "sessionOpening" }),
    { kind: "note", coachDone: false },
  );
  for (const screen of [
    { kind: "prep" },
    { kind: "blockage" },
    { kind: "uploading" },
    { kind: "analyzing" },
    { kind: "chat" },
    { kind: "note", coachDone: false },
  ]) {
    assert.deepEqual(advance(screen, { type: "sessionOpening" }), screen);
  }
});

test("연 연습이 아직 대기 중이면 훑어보는 자리, 실패면 실패 자리, 끝났으면 대화다", () => {
  const opening = { kind: "analyzing" };
  for (const status of ["created", "analyzing"]) {
    assert.deepEqual(advance(opening, { type: "sessionLoaded", status }), {
      kind: "analyzing",
    });
  }
  assert.deepEqual(advance(opening, { type: "sessionLoaded", status: "failed" }), {
    kind: "analysisFailed",
  });
  // 노트가 있는지 물어보는 동안 대화 화면에 선다.
  assert.deepEqual(advance(opening, { type: "sessionLoaded", status: "analyzed" }), {
    kind: "chat",
  });
});

test("지난 연습의 노트를 받아 열면 돌아갈 대화가 없다", () => {
  assert.deepEqual(advance({ kind: "chat" }, { type: "noteLoaded" }), {
    kind: "note",
    coachDone: false,
  });
});

test("코치를 부르기 시작하면 대화 화면에 선다", () => {
  assert.deepEqual(advance({ kind: "analyzing" }, { type: "coachStarting" }), {
    kind: "chat",
  });
  // 막힌 대화를 처음부터 다시 여는 길도 같은 자리로 온다.
  assert.deepEqual(
    advance({ kind: "note", coachDone: true }, { type: "coachStarting" }),
    { kind: "chat" },
  );
});

test("코치가 대화를 마쳤다고 하면 화면에 이름이 붙는다", () => {
  assert.deepEqual(
    advance({ kind: "chat" }, { type: "coachTurnReceived", done: true }),
    { kind: "chatDone" },
  );
  assert.deepEqual(
    advance({ kind: "chat" }, { type: "coachTurnReceived", done: false }),
    { kind: "chat" },
  );
});

test("코치 응답은 대화 화면 밖을 건드리지 않는다", () => {
  for (const screen of EVERY_SCREEN) {
    if (screen.kind === "chat" || screen.kind === "chatDone") continue;
    assert.deepEqual(
      advance(screen, { type: "coachTurnReceived", done: true }),
      screen,
      `${screen.kind} 이 코치 응답에 움직였다`,
    );
  }
});

test("대화를 마치고 연 노트만 돌아갈 대화를 갖는다", () => {
  assert.deepEqual(advance({ kind: "chatDone" }, { type: "noteOpened" }), {
    kind: "note",
    coachDone: true,
  });
});

test("노트에서 대화로 돌아가면 마쳤던 대화는 마친 자리로 돌아간다", () => {
  assert.deepEqual(
    advance({ kind: "note", coachDone: true }, { type: "chatReopened" }),
    { kind: "chatDone" },
  );
  // 목록에서 연 지난 연습은 코치가 붙은 적이 없어 빈 대화로 간다.
  assert.deepEqual(
    advance({ kind: "note", coachDone: false }, { type: "chatReopened" }),
    { kind: "chat" },
  );
});

test("대화를 마치고 노트를 열었다 돌아오기를 되풀이해도 자리가 흔들리지 않는다", () => {
  let screen = { kind: "chat" };
  for (let round = 0; round < 3; round += 1) {
    screen = advance(screen, { type: "coachTurnReceived", done: true });
    assert.deepEqual(screen, { kind: "chatDone" });
    screen = advance(screen, { type: "noteOpened" });
    assert.deepEqual(screen, { kind: "note", coachDone: true });
    screen = advance(screen, { type: "chatReopened" });
    assert.deepEqual(screen, { kind: "chatDone" });
  }
});

test("연습을 떠난 자리는 이미 쌓인 계측 이름 둘로만 말한다", () => {
  assert.equal(abandonedStage({ kind: "analyzing" }), "preparing");
  assert.equal(abandonedStage({ kind: "analysisFailed" }), "preparing");
  assert.equal(abandonedStage({ kind: "chat" }), "chat");
  assert.equal(abandonedStage({ kind: "chatDone" }), "chat");
  for (const screen of [
    { kind: "prep" },
    { kind: "blockage" },
    { kind: "uploading" },
    { kind: "note", coachDone: true },
  ]) {
    assert.equal(abandonedStage(screen), null, `${screen.kind} 에서 이탈을 셌다`);
  }
});

test("같은 자리에 머무는 전이는 받은 것을 그대로 돌려준다", () => {
  // 폴링은 3초마다, 코치는 응답마다 같은 답을 들고 온다. 그때마다 새 것을 만들면
  // 아무것도 안 바뀐 화면이 다시 그려진다 — 옛 setMode 는 같은 문자열이라 거기서 멈췄다.
  const analyzing = { kind: "analyzing" };
  assert.equal(
    advance(analyzing, { type: "analysisStatusReported", status: "analyzing" }),
    analyzing,
  );
  const analysisFailed = { kind: "analysisFailed" };
  assert.equal(
    advance(analysisFailed, { type: "analysisStatusReported", status: "failed" }),
    analysisFailed,
  );
  const chat = { kind: "chat" };
  assert.equal(advance(chat, { type: "coachTurnReceived", done: false }), chat);
  const note = { kind: "note", coachDone: false };
  assert.equal(advance(note, { type: "sessionOpening" }), note);
});

test("전이는 받은 화면을 그 자리에서 고치지 않는다", () => {
  const screen = { kind: "note", coachDone: true };
  const before = { ...screen };
  advance(screen, { type: "chatReopened" });
  advance(screen, { type: "sessionOpening" });
  assert.deepEqual(screen, before);
});
