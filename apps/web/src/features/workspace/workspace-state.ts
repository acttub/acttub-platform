// 연습 화면이 지금 어느 자리에 서 있는지, 그 자리가 무엇을 들고 있는지,
// 그리고 무슨 일이 그 자리를 옮기는지.
//
// 지금까지 이 자리는 mode(6) 에 coachDone 과 analysisStatus === "failed" 가 곱해져
// 정해졌고, 그 곱에는 이름이 없는 자리가 둘 있었다 — 분석이 실패한 화면과 대화가
// 끝난 화면. 여기서 그 둘이 analysisFailed · chatDone 으로 이름을 갖는다.
//
// 골라 둔 영상과 이어받을 연습도 화면과 따로 노는 state 였다. 그래서 막힘을 고르는
// 중인데 영상이 없거나, 대화 화면인데 이어받기 배너가 켜져 있는 조합이 만들어졌다.
// 이제 그 데이터를 화면이 직접 들어 그런 조합이 타입으로 서지 않는다.
//
// 브라우저 API 도 훅도 쓰지 않아 함수 호출만으로 전이를 확인할 수 있다 —
// blockage-flow.ts 와 같은 모양이고, 마크업을 단언하지 않는다는 규칙
// (apps/web/CLAUDE.md)을 지키면서 전이를 고정할 수 있는 표면이다.

import type { PracticeSessionStatus } from "@/lib/api/v2/types";

/**
 * 배우가 방금 고른 로컬 원본. 파일과 그 blob 주소는 늘 함께 서고 함께 사라진다 —
 * 파일은 압축·업로드가 쓰고, 주소는 화면이 튼다.
 */
export type PickedVideo = { file: File; url: string };

/**
 * 끝난 연습에서 "이어서 새 연습" 을 눌러 왔을 때 이어받을 연습. 세션을 만들 때 실어
 * 보내면 코치가 (가장 최근이 아니라) 이 연습의 대화를 이어받는다 (SOMA-417).
 */
export type ContinueFrom = { id: string; label: string | null };

/**
 * 지금 어느 화면인가(Practice Stage). 준비 → 업로드 → 분석 → 대화 → 노트로 가면서
 * 화면이 대화 쪽으로 좁혀지고, 준비 계열이 들고 있던 것들은 하나씩 할 일을 마친다.
 */
export type WorkspaceScreen =
  /** 영상과 장면을 채우는 첫 화면. 영상은 아직 없을 수 있다. */
  | { kind: "prep"; video: PickedVideo | null; continueFrom: ContinueFrom | null }
  /** 무엇이 막혔는지 고르는 중. 뒤에서는 그 영상의 압축·업로드가 이미 돌고 있다. */
  | { kind: "blockage"; video: PickedVideo; continueFrom: ContinueFrom | null }
  /** 올리는 중. */
  | { kind: "uploading"; video: PickedVideo; continueFrom: ContinueFrom | null }
  /**
   * 서버가 장면을 훑어보는 중. 여기까지 온 영상은 계속 재생된다 —
   * 목록·주소로 연 연습은 로컬 원본이 없어 서버가 준 주소로 튼다.
   */
  | { kind: "analyzing"; video: PickedVideo | null }
  /** 훑어보기가 실패했다. 같은 자리에 남되 근거 없이 시작하는 길이 열린다. */
  | { kind: "analysisFailed"; video: PickedVideo | null }
  /** 코치와 대화 중. */
  | { kind: "chat" }
  /** 대화가 끝났다. 화면은 여전히 대화이고 노트로 넘어갈 길이 생긴다. */
  | { kind: "chatDone" }
  /**
   * 연습 노트. 대화를 마치고 온 노트만 돌아갈 대화가 있다 —
   * 지난 연습을 목록에서 열면 코치가 붙은 적이 없어 빈 대화로 돌아간다.
   */
  | { kind: "note"; coachDone: boolean };

export const initialWorkspaceScreen: WorkspaceScreen = {
  kind: "prep",
  video: null,
  continueFrom: null,
};

export type WorkspaceAction =
  /**
   * 새 연습 준비 화면으로 되돌린다. 이어받을 연습을 함께 주면 그것만 들고 선다 —
   * 노트의 "이어서 새 연습" 이 그 길이다.
   */
  | { type: "reset"; continueFrom?: ContinueFrom | null }
  /** 영상을 골랐다(처음이거나 갈아 끼우거나). */
  | { type: "videoPicked"; video: PickedVideo }
  /** "이어받지 않기" — 이어받을 연습만 떼어 낸다. */
  | { type: "continueDeclined" }
  /** "질문 받기" — 막힘을 고르러 간다. */
  | { type: "blockageChosen" }
  /** 막힘을 다 골라 올리기 시작했다. */
  | { type: "uploadStarted" }
  /** 올리다 실패했다. */
  | { type: "uploadFailed" }
  /** 연습 세션이 만들어졌다. */
  | { type: "sessionCreated"; status: PracticeSessionStatus }
  /** 폴링이 훑어보기 상태를 물어 왔다. */
  | { type: "analysisStatusReported"; status: PracticeSessionStatus }
  /** 목록에서 다른 연습을 여는 중이다(조회 전). */
  | { type: "sessionOpening" }
  /** 그 연습을 받아 왔다. */
  | { type: "sessionLoaded"; status: PracticeSessionStatus }
  /** 그 연습의 노트까지 받아 왔다. */
  | { type: "noteLoaded" }
  /** 코치를 부르기 시작했다. */
  | { type: "coachStarting" }
  /** 코치가 답했다. */
  | { type: "coachTurnReceived"; done: boolean }
  /** 배우가 정리보기를 눌렀다. */
  | { type: "noteOpened" }
  /** 노트에서 대화로 돌아간다. */
  | { type: "chatReopened" };

/**
 * 이미 그 자리면 받은 것을 그대로 돌려준다. 폴링은 3초마다, 코치는 응답마다 같은 답을
 * 들고 오는데 그때마다 새 객체를 만들면 화면이 아무것도 안 바뀐 채로 다시 그려진다 —
 * 옛 `setMode("preparing")` 은 같은 문자열이라 그 자리에서 멈췄다.
 * 아래 네 도우미가 각각 자기 자리의 값까지 견줘 그 멈춤을 지킨다.
 */
function stay(
  screen: WorkspaceScreen,
  kind: "chat" | "chatDone",
): WorkspaceScreen {
  return screen.kind === kind ? screen : { kind };
}

function prepScreen(
  screen: WorkspaceScreen,
  video: PickedVideo | null,
  continueFrom: ContinueFrom | null,
): WorkspaceScreen {
  return screen.kind === "prep" &&
    screen.video === video &&
    screen.continueFrom === continueFrom
    ? screen
    : { kind: "prep", video, continueFrom };
}

function analysisScreen(
  screen: WorkspaceScreen,
  kind: "analyzing" | "analysisFailed",
  video: PickedVideo | null,
): WorkspaceScreen {
  return screen.kind === kind && screen.video === video
    ? screen
    : { kind, video };
}

/** 노트 화면도 같은 규칙을 따른다 — 돌아갈 대화까지 같으면 받은 것을 그대로 돌려준다. */
function noteScreen(screen: WorkspaceScreen, coachDone: boolean): WorkspaceScreen {
  return screen.kind === "note" && screen.coachDone === coachDone
    ? screen
    : { kind: "note", coachDone };
}

/**
 * 지금 화면이 들고 있는 로컬 원본. 훑어보기 자리까지 따라오고 거기서 끝난다 —
 * 대화·노트로 넘어간 화면은 그것을 그리지 않는다.
 * 화면 밖에서는 blob 주소를 언제 놓아 줄지 정하는 데 쓴다.
 */
export function pickedVideo(screen: WorkspaceScreen): PickedVideo | null {
  switch (screen.kind) {
    case "prep":
    case "blockage":
    case "uploading":
    case "analyzing":
    case "analysisFailed":
      return screen.video;
    default:
      return null;
  }
}

function carriedContinueFrom(screen: WorkspaceScreen): ContinueFrom | null {
  switch (screen.kind) {
    case "prep":
    case "blockage":
    case "uploading":
      return screen.continueFrom;
    default:
      return null;
  }
}

export function workspaceScreenReducer(
  screen: WorkspaceScreen,
  action: WorkspaceAction,
): WorkspaceScreen {
  switch (action.type) {
    case "reset":
      return prepScreen(screen, null, action.continueFrom ?? null);
    case "videoPicked":
      if (screen.kind !== "prep") return screen;
      return prepScreen(screen, action.video, screen.continueFrom);
    case "continueDeclined":
      if (screen.kind !== "prep") return screen;
      return prepScreen(screen, screen.video, null);
    case "blockageChosen":
      // 올릴 영상이 없으면 고를 막힘도 없다. 옛 코드에서는 시작 버튼의 가드가
      // 이 자리를 지켰고, 이제 화면이 자기 데이터로 지킨다.
      if (screen.kind !== "prep" || !screen.video) return screen;
      return {
        kind: "blockage",
        video: screen.video,
        continueFrom: screen.continueFrom,
      };
    case "uploadStarted":
      if (screen.kind !== "blockage") return screen;
      return {
        kind: "uploading",
        video: screen.video,
        continueFrom: screen.continueFrom,
      };
    case "uploadFailed":
      // 다시 시도하려면 고른 영상과 이어받을 연습이 그대로 있어야 한다.
      return prepScreen(screen, pickedVideo(screen), carriedContinueFrom(screen));
    case "sessionCreated":
      // 막 만든 세션도 곧바로 실패로 올 수 있다. 그때도 대화로 가지 않는다 —
      // 근거 없이 시작할지는 배우가 그 자리에서 고른다.
      // 이어받을 연습은 이 요청에 이미 실려 갔으므로 여기서 할 일을 마친다.
      return analysisScreen(
        screen,
        action.status === "failed" ? "analysisFailed" : "analyzing",
        pickedVideo(screen),
      );
    case "analysisStatusReported":
      // 훑어보기 자리를 떠난 뒤에 도착한 상태는 화면을 되돌리지 않는다 —
      // 근거 없이 대화를 시작한 사람을 폴링이 진행 자리로 끌어오면 안 된다.
      if (screen.kind !== "analyzing" && screen.kind !== "analysisFailed") return screen;
      return analysisScreen(
        screen,
        action.status === "failed" ? "analysisFailed" : "analyzing",
        screen.video,
      );
    case "sessionOpening":
      // 아직 무엇을 열었는지 모르는 구간이다. 지금 화면에서 지난 연습의 흔적만 걷어낸다.
      // 여기서 고르던 영상도 함께 버린다 — 남겨 두면 화면이 로컬 원본을 서버 주소보다
      // 먼저 잡아 남의 영상을 튼다. 그 압축·업로드는 이 순간 이미 끊겼다.
      if (screen.kind === "chatDone") return { kind: "chat" };
      if (screen.kind === "analyzing" || screen.kind === "analysisFailed") {
        return analysisScreen(screen, "analyzing", null);
      }
      if (screen.kind === "note") return noteScreen(screen, false);
      if (screen.kind === "chat") return screen;
      return prepScreen(screen, null, null);
    case "sessionLoaded":
      // 받아 온 연습은 서버가 준 주소로 튼다. 여기서 고르던 로컬 원본을 들면
      // 남의 연습에 내 영상이 실린다.
      if (action.status === "created" || action.status === "analyzing") {
        return analysisScreen(screen, "analyzing", null);
      }
      if (action.status === "failed") return analysisScreen(screen, "analysisFailed", null);
      // 훑어보기가 끝난 연습은 노트가 있는지 물어보는 동안 대화 화면에 선다.
      return stay(screen, "chat");
    case "noteLoaded":
      return noteScreen(screen, false);
    case "coachStarting":
      return stay(screen, "chat");
    case "coachTurnReceived":
      if (screen.kind !== "chat" && screen.kind !== "chatDone") return screen;
      return stay(screen, action.done ? "chatDone" : "chat");
    case "noteOpened":
      return noteScreen(screen, screen.kind === "chatDone");
    case "chatReopened":
      return stay(
        screen,
        screen.kind === "note" && screen.coachDone ? "chatDone" : "chat",
      );
  }
}

/**
 * 연습을 떠난 사람이 어느 자리에서 떠났는지. 두 이름은 이미 쌓인 계측 값이라
 * 화면 이름과 따로 둔다 — 화면이 갈려도 이 문자열은 그대로여야 한다.
 */
export function abandonedStage(
  screen: WorkspaceScreen,
): "preparing" | "chat" | null {
  switch (screen.kind) {
    case "analyzing":
    case "analysisFailed":
      return "preparing";
    case "chat":
    case "chatDone":
      return "chat";
    default:
      return null;
  }
}
