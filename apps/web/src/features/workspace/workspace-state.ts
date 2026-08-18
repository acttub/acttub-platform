// 연습 화면이 지금 어느 자리에 서 있는지, 그리고 무슨 일이 그 자리를 옮기는지.
//
// 지금까지 이 자리는 mode(6) 에 coachDone 과 analysisStatus === "failed" 가 곱해져
// 정해졌고, 그 곱에는 이름이 없는 자리가 둘 있었다 — 분석이 실패한 화면과 대화가
// 끝난 화면. 여기서 그 둘이 analysisFailed · chatDone 으로 이름을 갖는다.
//
// 브라우저 API 도 훅도 쓰지 않아 함수 호출만으로 전이를 확인할 수 있다 —
// blockage-flow.ts 와 같은 모양이고, 마크업을 단언하지 않는다는 규칙
// (apps/web/CLAUDE.md)을 지키면서 전이를 고정할 수 있는 표면이다.

import type { PracticeSessionStatus } from "@/lib/api/v2/types";

/**
 * 지금 어느 화면인가(Practice Stage). 준비 → 업로드 → 분석 → 대화 → 노트로 가면서
 * 화면이 대화 쪽으로 좁혀진다.
 */
export type WorkspaceScreen =
  /** 영상과 장면을 채우는 첫 화면. */
  | { kind: "prep" }
  /** 무엇이 막혔는지 고르는 중. 뒤에서는 압축·업로드가 이미 돌고 있다. */
  | { kind: "blockage" }
  /** 올리는 중. */
  | { kind: "uploading" }
  /** 서버가 장면을 훑어보는 중. */
  | { kind: "analyzing" }
  /** 훑어보기가 실패했다. 같은 자리에 남되 근거 없이 시작하는 길이 열린다. */
  | { kind: "analysisFailed" }
  /** 코치와 대화 중. */
  | { kind: "chat" }
  /** 대화가 끝났다. 화면은 여전히 대화이고 노트로 넘어갈 길이 생긴다. */
  | { kind: "chatDone" }
  /**
   * 연습 노트. 대화를 마치고 온 노트만 돌아갈 대화가 있다 —
   * 지난 연습을 목록에서 열면 코치가 붙은 적이 없어 빈 대화로 돌아간다.
   */
  | { kind: "note"; coachDone: boolean };

export const initialWorkspaceScreen: WorkspaceScreen = { kind: "prep" };

export type WorkspaceAction =
  /** 새 연습 준비 화면으로 되돌린다. */
  | { type: "reset" }
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
 */
function stay<K extends WorkspaceScreen["kind"]>(
  screen: WorkspaceScreen,
  kind: K,
): WorkspaceScreen {
  return screen.kind === kind ? screen : ({ kind } as WorkspaceScreen);
}

/** 노트 화면도 같은 규칙을 따른다 — 돌아갈 대화까지 같으면 받은 것을 그대로 돌려준다. */
function noteScreen(screen: WorkspaceScreen, coachDone: boolean): WorkspaceScreen {
  return screen.kind === "note" && screen.coachDone === coachDone
    ? screen
    : { kind: "note", coachDone };
}

export function workspaceScreenReducer(
  screen: WorkspaceScreen,
  action: WorkspaceAction,
): WorkspaceScreen {
  switch (action.type) {
    case "reset":
      return stay(screen, "prep");
    case "blockageChosen":
      return stay(screen, "blockage");
    case "uploadStarted":
      return stay(screen, "uploading");
    case "uploadFailed":
      return stay(screen, "prep");
    case "sessionCreated":
      // 막 만든 세션도 곧바로 실패로 올 수 있다. 그때도 대화로 가지 않는다 —
      // 근거 없이 시작할지는 배우가 그 자리에서 고른다.
      return stay(screen, action.status === "failed" ? "analysisFailed" : "analyzing");
    case "analysisStatusReported":
      // 훑어보기 자리를 떠난 뒤에 도착한 상태는 화면을 되돌리지 않는다 —
      // 근거 없이 대화를 시작한 사람을 폴링이 진행 자리로 끌어오면 안 된다.
      if (screen.kind !== "analyzing" && screen.kind !== "analysisFailed") return screen;
      return stay(screen, action.status === "failed" ? "analysisFailed" : "analyzing");
    case "sessionOpening":
      // 아직 무엇을 열었는지 모르는 구간이다. 지금 화면에서 지난 연습의 흔적만 걷어낸다.
      if (screen.kind === "chatDone") return { kind: "chat" };
      if (screen.kind === "analysisFailed") return { kind: "analyzing" };
      if (screen.kind === "note") return noteScreen(screen, false);
      return screen;
    case "sessionLoaded":
      if (action.status === "created" || action.status === "analyzing") {
        return stay(screen, "analyzing");
      }
      if (action.status === "failed") return stay(screen, "analysisFailed");
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
