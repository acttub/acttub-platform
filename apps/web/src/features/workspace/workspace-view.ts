// 지금 화면이 무엇을 그리는지 정하는 규칙. workspace-app.tsx 의 렌더 분기를
// 그대로 옮긴 것이고, 옮기면서 바꾼 것은 없다.
// 브라우저 API도 훅도 쓰지 않아 함수 호출만으로 테스트할 수 있다 —
// 컴포넌트 마크업을 단언하지 않는다는 규칙(apps/web/CLAUDE.md)을 지키면서
// 이 화면의 행동을 고정할 수 있는 유일한 표면이다.
//
// 어느 화면인가와 그 화면이 무엇을 들고 있는가는 workspace-state.ts 가 정하고,
// 여기는 그것으로 무엇을 그리는지만 정한다.

import type { PracticeReport } from "@/lib/api/v2/types";
import { isChatScreen, type WorkspaceScreen } from "./workspace-state";

/**
 * setup 몸통을 그리는 화면들. 서로 다른 Practice Stage 넷이 같은 몸통을 쓴다 —
 * 준비 순서(Setup Step)와는 다른 층이라 이름에 body 를 붙여 가른다.
 */
type SetupBodyScreen = Extract<
  WorkspaceScreen,
  { kind: "prep" | "uploading" | "analyzing" | "analysisFailed" }
>;

/** 화면 밖에서 오는 값만. 훅이 내려 주는 값(pct·pastDeadline 등)은 분기를 가르지 않아 뺐다. */
export type WorkspaceViewInput = {
  screen: WorkspaceScreen;
  /** 서버가 준 재생 주소(`detail.playback_url`). 로컬 원본이 없을 때 쓴다. */
  playbackUrl: string | null;
};

export type WorkspaceVideoSlot =
  | { kind: "player"; src: string; caption: string; reselectable: boolean }
  | { kind: "upload-zone" }
  | { kind: "none" };

export type WorkspaceSetupFooter =
  | { kind: "start"; ready: boolean }
  | { kind: "progress"; phase: "upload" }
  | { kind: "progress"; phase: "scan"; failed: boolean };

export type WorkspaceViewBody =
  | {
      kind: "chat";
      done: boolean;
      noteReady: boolean;
      /** 코치가 붙었고 아직 대화 중이다 — 그래야 답을 보낼 수 있다. */
      coachReady: boolean;
    }
  | { kind: "note"; report: PracticeReport; backTo: "chat" | "restart" }
  | {
      kind: "setup";
      step: 1 | 2;
      video: WorkspaceVideoSlot;
      footer: WorkspaceSetupFooter;
      continueBanner: { label: string | null; dismissible: boolean } | null;
    };

/** 헤더 상태 칩의 종류. 문구와 색은 컴포넌트가 정한다. */
export type WorkspaceStatusChip =
  | "uploading"
  | "analyzing"
  | "chat"
  | "chat-done"
  | "note";

export type WorkspaceView = {
  body: WorkspaceViewBody;
  statusChip: WorkspaceStatusChip | null;
  /** 후기는 대화가 시작된 뒤에만 묻는다. 종류는 어느 화면에서 나갔는지를 가른다. */
  review: { armed: boolean; kind: "chat" | "note" };
};

const UPLOADING_CAPTION = "업로드 중에도 영상은 볼 수 있어요";
const UPLOADED_CAPTION = "올린 영상";

export function describeWorkspaceView(input: WorkspaceViewInput): WorkspaceView {
  const { kind } = input.screen;
  return {
    body: describeBody(input),
    statusChip: describeStatusChip(input.screen),
    review: {
      armed: isChatScreen(input.screen) || kind === "note",
      kind: kind === "note" ? "note" : "chat",
    },
  };
}

function describeBody(input: WorkspaceViewInput): WorkspaceViewBody {
  const screen = input.screen;
  if (screen.kind === "note") {
    // 막힌 대화의 노트는 되돌아갈 대화가 없어 처음부터 다시 연다.
    return {
      kind: "note",
      report: screen.report,
      backTo: screen.report.report_type === "blocked" ? "restart" : "chat",
    };
  }
  if (isChatScreen(screen)) {
    return {
      kind: "chat",
      done: screen.kind === "chatDone",
      noteReady: screen.report !== null,
      // 빈 코치 id 는 코치가 없는 것과 같이 다룬다 — 옛 가드가 `&& coachSessionId` 로
      // 그것을 걸렀다. 좁히면 답을 못 보내는 세션으로 입력이 열린다.
      coachReady: Boolean(screen.kind === "chat" && screen.coachId),
    };
  }
  return describeSetup(screen, input);
}

function describeSetup(
  screen: SetupBodyScreen,
  input: WorkspaceViewInput,
): Extract<WorkspaceViewBody, { kind: "setup" }> {
  const kind = screen.kind;
  const uploading = kind === "uploading";
  const prep = kind === "prep";
  const video = screen.video;
  // 방금 고른 로컬 원본이 있으면 그걸 계속 재생한다. 서버 주소를 먼저 쓰면 업로드가
  // 끝나는 순간 src 가 갈아끼워지면서 영상 자리가 한 번 비고 기준 길이까지 흔들린다.
  const src = video?.url ?? input.playbackUrl;
  // 이어받기는 새 연습을 만들 때까지만 뜻이 있다. 훑어보기 자리는 그것을 들지 않는다.
  const continueFrom = prep || uploading ? screen.continueFrom : null;
  return {
    kind: "setup",
    step: prep && !video ? 1 : 2,
    video: src
      ? {
          kind: "player",
          src,
          caption: uploading ? UPLOADING_CAPTION : video?.file.name ?? UPLOADED_CAPTION,
          reselectable: prep,
        }
      : prep
        ? { kind: "upload-zone" }
        : { kind: "none" },
    footer: uploading
      ? { kind: "progress", phase: "upload" }
      : kind === "analyzing" || kind === "analysisFailed"
        ? { kind: "progress", phase: "scan", failed: kind === "analysisFailed" }
        : {
            kind: "start",
            ready: video !== null,
          },
    continueBanner: continueFrom
      ? { label: continueFrom.label, dismissible: prep }
      : null,
  };
}

function describeStatusChip(screen: WorkspaceScreen): WorkspaceStatusChip | null {
  switch (screen.kind) {
    case "prep":
      return null;
    case "uploading":
      return "uploading";
    case "analyzing":
    case "analysisFailed":
      return "analyzing";
    // 코치를 기다리는 동안에도 화면은 대화다.
    case "chatOpening":
    case "chat":
      return "chat";
    // 대화가 끝나도 노트로 넘어가기 전까지는 대화 화면이다. 그동안 "대화 중"이라고
    // 하면 화면과 어긋나므로 끝났다고 말한다.
    case "chatDone":
      return "chat-done";
    case "note":
      return "note";
  }
}
