// 연습 화면이 무슨 일에 어떻게 옮겨 가는지, 그리고 그 자리가 무엇을 들고 있는지
// 고정하는 전이표 테스트. 해체(SOMA-409) 전의 행동을 그대로 못박는 것이 목적이다 —
// 옮기기 전에는 mode(6) 에 coachDone 과 analysisStatus === "failed" 가 곱해져 정해졌고,
// 골라 둔 영상·이어받을 연습은 화면과 따로 노는 state 였다. 곱을 하나로 합치고
// 데이터를 화면 안으로 들이면서 흘린 것이 있으면 여기서 빨간불이 켜져야 한다.
// 그 화면이 무엇을 그리는지는 workspace-view.test.mjs 가 따로 지킨다.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { abandonedStage, initialWorkspaceScreen, workspaceScreenReducer } =
  await import("../src/features/workspace/workspace-state.ts");

/** 배우가 고른 로컬 원본. 파일과 그 blob 주소는 늘 함께 선다. */
const VIDEO = {
  file: new File(["one"], "take-1.mp4", { type: "video/mp4" }),
  url: "blob:take-1",
};
const OTHER_VIDEO = {
  file: new File(["two"], "take-2.mp4", { type: "video/mp4" }),
  url: "blob:take-2",
};
/** 끝난 연습에서 "이어서 새 연습" 을 눌러 왔을 때 이어받을 연습. */
const CONTINUE = { id: "practice-1", label: "면접 장면" };

/** 도달 가능한 화면 전부. "어느 자리에서 와도" 를 물을 때 쓴다. */
const EVERY_SCREEN = [
  { kind: "prep", video: null, continueFrom: null },
  { kind: "prep", video: VIDEO, continueFrom: CONTINUE },
  { kind: "blockage", video: VIDEO, continueFrom: null },
  { kind: "uploading", video: VIDEO, continueFrom: CONTINUE },
  { kind: "analyzing", video: VIDEO },
  { kind: "analyzing", video: null },
  { kind: "analysisFailed", video: null },
  { kind: "chat" },
  { kind: "chatDone" },
  { kind: "note", coachDone: true },
  { kind: "note", coachDone: false },
];

const EMPTY_PREP = { kind: "prep", video: null, continueFrom: null };

const advance = (screen, action) => workspaceScreenReducer(screen, action);

test("첫 화면은 빈 준비 화면이다", () => {
  assert.deepEqual(initialWorkspaceScreen, EMPTY_PREP);
});

test("새 연습으로 되돌리면 어느 자리에서 왔든 빈 준비 화면에 선다", () => {
  for (const screen of EVERY_SCREEN) {
    assert.deepEqual(advance(screen, { type: "reset" }), EMPTY_PREP);
  }
});

test("영상을 고르면 준비 화면이 그것을 든다", () => {
  const picked = advance(EMPTY_PREP, { type: "videoPicked", video: VIDEO });
  assert.deepEqual(picked, { kind: "prep", video: VIDEO, continueFrom: null });
  // 다시 고르면 앞서 고른 것을 갈아치운다.
  assert.deepEqual(advance(picked, { type: "videoPicked", video: OTHER_VIDEO }), {
    kind: "prep",
    video: OTHER_VIDEO,
    continueFrom: null,
  });
});

test("영상을 갈아 끼워도 이어받을 연습은 그대로 남는다", () => {
  assert.deepEqual(
    advance(
      { kind: "prep", video: null, continueFrom: CONTINUE },
      { type: "videoPicked", video: VIDEO },
    ),
    { kind: "prep", video: VIDEO, continueFrom: CONTINUE },
  );
});

test("영상 고르기는 준비 화면 밖을 건드리지 않는다", () => {
  for (const screen of EVERY_SCREEN) {
    if (screen.kind === "prep") continue;
    assert.deepEqual(
      advance(screen, { type: "videoPicked", video: OTHER_VIDEO }),
      screen,
      `${screen.kind} 이 영상 고르기에 움직였다`,
    );
  }
});

test("이어받기를 되돌린 새 연습은 이어받을 연습을 함께 들고 선다", () => {
  // 노트에서 "이어서 새 연습" 을 누르면 화면은 처음으로 돌아가되 이어받을 연습만 남는다.
  // 옛 코드는 이것을 둘로 나눠 부르면서 "되돌리기가 표시를 지우므로 그 뒤에 켠다" 는
  // 순서에 기대고 있었다 — 뒤집으면 배너가 뜨지 않았다. 되돌리기가 그 값을 받는
  // 지금은 켜는 액션이 이것 하나뿐이라 순서가 남지 않는다.
  assert.deepEqual(
    advance({ kind: "note", coachDone: true }, { type: "reset", continueFrom: CONTINUE }),
    { kind: "prep", video: null, continueFrom: CONTINUE },
  );
});

test("이어받지 않기를 누르면 그 표시만 사라진다", () => {
  assert.deepEqual(
    advance(
      { kind: "prep", video: VIDEO, continueFrom: CONTINUE },
      { type: "continueDeclined" },
    ),
    { kind: "prep", video: VIDEO, continueFrom: null },
  );
});

test("질문 받기를 누르면 막힘 선택으로, 다 고르면 업로드로 간다", () => {
  const prep = { kind: "prep", video: VIDEO, continueFrom: CONTINUE };
  const blockage = advance(prep, { type: "blockageChosen" });
  // 고른 영상과 이어받을 연습이 따라간다 — 뒤에서 그 영상을 올리고 있고,
  // 세션을 만들 때 이어받을 연습을 실어 보낸다.
  assert.deepEqual(blockage, { kind: "blockage", video: VIDEO, continueFrom: CONTINUE });
  assert.deepEqual(advance(blockage, { type: "uploadStarted" }), {
    kind: "uploading",
    video: VIDEO,
    continueFrom: CONTINUE,
  });
});

test("영상 없이는 막힘 선택으로 가지 않는다", () => {
  assert.deepEqual(advance(EMPTY_PREP, { type: "blockageChosen" }), EMPTY_PREP);
});

test("올리다 실패하면 준비 화면으로 돌아가되 고른 것은 남는다", () => {
  // 다시 시도하려면 영상과 이어받을 연습이 그대로 있어야 한다.
  assert.deepEqual(
    advance(
      { kind: "uploading", video: VIDEO, continueFrom: CONTINUE },
      { type: "uploadFailed" },
    ),
    { kind: "prep", video: VIDEO, continueFrom: CONTINUE },
  );
});

test("세션이 만들어지면 훑어보는 자리로 가고, 곧바로 실패로 와도 대화로 가지 않는다", () => {
  const uploading = { kind: "uploading", video: VIDEO, continueFrom: CONTINUE };
  for (const status of ["created", "analyzing", "analyzed"]) {
    assert.deepEqual(advance(uploading, { type: "sessionCreated", status }), {
      kind: "analyzing",
      video: VIDEO,
    });
  }
  assert.deepEqual(advance(uploading, { type: "sessionCreated", status: "failed" }), {
    kind: "analysisFailed",
    video: VIDEO,
  });
});

test("세션이 만들어지면 이어받기 표시는 할 일을 다 했다", () => {
  // 이어받을 연습은 세션을 만드는 요청에 이미 실려 갔다. 화면에 남기면 다음 연습까지
  // 따라간다 — 훑어보기 자리에는 그것을 담을 곳이 없다.
  const analyzing = advance(
    { kind: "uploading", video: VIDEO, continueFrom: CONTINUE },
    { type: "sessionCreated", status: "analyzing" },
  );
  assert.equal("continueFrom" in analyzing, false);
});

test("훑어보기가 실패하면 같은 자리에 이름만 갈려서 남는다", () => {
  const analyzing = { kind: "analyzing", video: VIDEO };
  assert.deepEqual(
    advance(analyzing, { type: "analysisStatusReported", status: "failed" }),
    { kind: "analysisFailed", video: VIDEO },
  );
  assert.deepEqual(
    advance(analyzing, { type: "analysisStatusReported", status: "analyzed" }),
    { kind: "analyzing", video: VIDEO },
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
  // 무엇을 열었는지는 아직 모른다. 앞 연습이 남긴 표시만 지운다.
  assert.deepEqual(advance({ kind: "chatDone" }, { type: "sessionOpening" }), {
    kind: "chat",
  });
  assert.deepEqual(
    advance({ kind: "analysisFailed", video: null }, { type: "sessionOpening" }),
    { kind: "analyzing", video: null },
  );
  assert.deepEqual(
    advance({ kind: "note", coachDone: true }, { type: "sessionOpening" }),
    { kind: "note", coachDone: false },
  );
  for (const screen of [
    EMPTY_PREP,
    { kind: "analyzing", video: null },
    { kind: "chat" },
    { kind: "note", coachDone: false },
  ]) {
    assert.deepEqual(advance(screen, { type: "sessionOpening" }), screen);
  }
});

test("다른 연습을 열면 여기서 고르던 영상과 이어받기는 그 자리에서 버린다", () => {
  // 남겨 두면 화면이 로컬 원본을 서버 주소보다 먼저 잡아 남의 영상을 튼다.
  // 미리 시작한 압축·업로드도 이때 함께 끊긴다.
  for (const screen of [
    { kind: "prep", video: VIDEO, continueFrom: CONTINUE },
    { kind: "blockage", video: VIDEO, continueFrom: CONTINUE },
    { kind: "uploading", video: VIDEO, continueFrom: null },
  ]) {
    assert.deepEqual(
      advance(screen, { type: "sessionOpening" }),
      EMPTY_PREP,
      `${screen.kind} 이 고르던 것을 들고 남았다`,
    );
  }
  assert.deepEqual(
    advance({ kind: "analyzing", video: VIDEO }, { type: "sessionOpening" }),
    { kind: "analyzing", video: null },
  );
});

test("연 연습이 아직 대기 중이면 훑어보는 자리, 실패면 실패 자리, 끝났으면 대화다", () => {
  const opening = { kind: "analyzing", video: null };
  for (const status of ["created", "analyzing"]) {
    assert.deepEqual(advance(opening, { type: "sessionLoaded", status }), {
      kind: "analyzing",
      video: null,
    });
  }
  assert.deepEqual(advance(opening, { type: "sessionLoaded", status: "failed" }), {
    kind: "analysisFailed",
    video: null,
  });
  // 노트가 있는지 물어보는 동안 대화 화면에 선다.
  assert.deepEqual(advance(opening, { type: "sessionLoaded", status: "analyzed" }), {
    kind: "chat",
  });
});

test("받아 온 연습은 여기서 고르던 영상을 틀지 않는다", () => {
  // 주소로 여는 경로는 고르던 것을 미리 버리지 않는다. 받아 온 연습의 자리가
  // 로컬 원본을 들면 남의 연습에 내 영상이 실린다.
  assert.deepEqual(
    advance({ kind: "analyzing", video: VIDEO }, { type: "sessionLoaded", status: "analyzing" }),
    { kind: "analyzing", video: null },
  );
});

test("지난 연습의 노트를 받아 열면 돌아갈 대화가 없다", () => {
  assert.deepEqual(advance({ kind: "chat" }, { type: "noteLoaded" }), {
    kind: "note",
    coachDone: false,
  });
});

test("코치를 부르기 시작하면 대화 화면에 선다", () => {
  assert.deepEqual(
    advance({ kind: "analyzing", video: null }, { type: "coachStarting" }),
    { kind: "chat" },
  );
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
  assert.equal(abandonedStage({ kind: "analyzing", video: null }), "preparing");
  assert.equal(abandonedStage({ kind: "analysisFailed", video: VIDEO }), "preparing");
  assert.equal(abandonedStage({ kind: "chat" }), "chat");
  assert.equal(abandonedStage({ kind: "chatDone" }), "chat");
  for (const screen of [
    EMPTY_PREP,
    { kind: "blockage", video: VIDEO, continueFrom: null },
    { kind: "uploading", video: VIDEO, continueFrom: null },
    { kind: "note", coachDone: true },
  ]) {
    assert.equal(abandonedStage(screen), null, `${screen.kind} 에서 이탈을 셌다`);
  }
});

test("같은 자리에 머무는 전이는 받은 것을 그대로 돌려준다", () => {
  // 폴링은 3초마다, 코치는 응답마다 같은 답을 들고 온다. 그때마다 새 것을 만들면
  // 아무것도 안 바뀐 화면이 다시 그려진다 — 옛 setMode 는 같은 문자열이라 거기서 멈췄다.
  const analyzing = { kind: "analyzing", video: VIDEO };
  assert.equal(
    advance(analyzing, { type: "analysisStatusReported", status: "analyzing" }),
    analyzing,
  );
  const analysisFailed = { kind: "analysisFailed", video: null };
  assert.equal(
    advance(analysisFailed, { type: "analysisStatusReported", status: "failed" }),
    analysisFailed,
  );
  const chat = { kind: "chat" };
  assert.equal(advance(chat, { type: "coachTurnReceived", done: false }), chat);
  const note = { kind: "note", coachDone: false };
  assert.equal(advance(note, { type: "sessionOpening" }), note);
  // 이미 빈 준비 화면이면 되돌리기도 그 자리에 머문다.
  assert.equal(advance(EMPTY_PREP, { type: "reset" }), EMPTY_PREP);
  // 받아 온 연습이 이미 그 자리·같은 영상이면 폴링과 마찬가지로 멈춘다.
  const opened = { kind: "analyzing", video: null };
  assert.equal(advance(opened, { type: "sessionLoaded", status: "analyzing" }), opened);
  assert.equal(advance(opened, { type: "sessionOpening" }), opened);
  // 이어받을 것이 없는 준비 화면에서 이어받지 않기를 눌러도 같은 자리다.
  const noContinue = { kind: "prep", video: VIDEO, continueFrom: null };
  assert.equal(advance(noContinue, { type: "continueDeclined" }), noContinue);
});

test("전이는 받은 화면을 그 자리에서 고치지 않는다", () => {
  const screen = { kind: "note", coachDone: true };
  const before = { ...screen };
  advance(screen, { type: "chatReopened" });
  advance(screen, { type: "sessionOpening" });
  assert.deepEqual(screen, before);

  const prep = { kind: "prep", video: VIDEO, continueFrom: CONTINUE };
  const prepBefore = { ...prep };
  advance(prep, { type: "videoPicked", video: OTHER_VIDEO });
  advance(prep, { type: "continueDeclined" });
  advance(prep, { type: "blockageChosen" });
  assert.deepEqual(prep, prepBefore);
});
