// 지금 상태가 어떤 화면을 그리는지 정하는 규칙. workspace-app.tsx 의 렌더 분기를
// 그대로 옮긴 것이고, 옮기면서 바꾼 것은 없다.
// 브라우저 API도 훅도 쓰지 않아 함수 호출만으로 테스트할 수 있다 —
// 컴포넌트 마크업을 단언하지 않는다는 규칙(apps/web/CLAUDE.md)을 지키면서
// 이 화면의 행동을 고정할 수 있는 유일한 표면이다.

import type { PracticeReport, PracticeSessionDetail } from "@/lib/api/v2/types";

/**
 * 지금 어느 화면인가(Practice Stage). 준비 → 업로드 → 대화 → 노트로 가면서
 * 화면이 대화 쪽으로 좁혀진다. 이름은 지금 코드가 부르는 그대로 두었다 —
 * 용어집이 피하라는 "모드"이고, 판별 유니온으로 갈리면서 사라질 이름이다.
 */
export type Mode = "prep" | "blockage" | "uploading" | "preparing" | "chat" | "note";

/** 렌더가 실제로 읽는 상태만. 훅이 내려 주는 값(pct·pastDeadline 등)은 분기를 가르지 않아 뺐다. */
export type WorkspaceViewInput = {
  mode: Mode;
  /** 방금 고른 로컬 원본. 있고 없고가 스테퍼와 시작 버튼을 가르고, 이름은 영상 설명이 된다. */
  videoFile: { name: string } | null;
  /** 로컬 원본의 blob 주소. 서버 주소보다 먼저 쓴다. */
  videoUrl: string | null;
  /** 서버가 준 재생 주소(`detail.playback_url`). */
  playbackUrl: string | null;
  analysisStatus: PracticeSessionDetail["status"] | null;
  coachDone: boolean;
  /** 연습 노트가 없으면 null. */
  reportType: PracticeReport["report_type"] | null;
  continueFrom: { id: string; label: string | null } | null;
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
  | { kind: "chat"; done: boolean; noteReady: boolean }
  | { kind: "note"; backTo: "chat" | "restart" }
  | { kind: "blockage"; videoUrl: string }
  | {
      kind: "setup";
      step: 1 | 2 | 3;
      sceneLocked: boolean;
      video: WorkspaceVideoSlot;
      footer: WorkspaceSetupFooter;
      continueBanner: { label: string | null; dismissible: boolean } | null;
    };

/** 헤더 상태 칩의 종류. 문구와 색은 컴포넌트가 정한다. */
export type WorkspaceStatusChip =
  | "uploading"
  | "preparing"
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
  return {
    body: describeBody(input),
    statusChip: describeStatusChip(input),
    review: {
      armed: input.mode === "chat" || input.mode === "note",
      kind: input.mode === "note" ? "note" : "chat",
    },
  };
}

function describeBody(input: WorkspaceViewInput): WorkspaceViewBody {
  if (input.mode === "note") {
    // 막힌 대화의 노트는 되돌아갈 대화가 없어 처음부터 다시 연다.
    return {
      kind: "note",
      backTo: input.reportType === "blocked" ? "restart" : "chat",
    };
  }
  if (input.mode === "chat") {
    return {
      kind: "chat",
      done: input.coachDone,
      noteReady: input.reportType !== null,
    };
  }
  // 막힘 선택은 영상이 있어야 선다. 없으면 준비 화면으로 흘러내린다.
  if (input.mode === "blockage" && input.videoUrl !== null) {
    return { kind: "blockage", videoUrl: input.videoUrl };
  }
  return describeSetup(input);
}

function describeSetup(
  input: WorkspaceViewInput,
): Extract<WorkspaceViewBody, { kind: "setup" }> {
  const waitingForCoach = input.mode === "uploading" || input.mode === "preparing";
  // 방금 고른 로컬 원본이 있으면 그걸 계속 재생한다. 서버 주소를 먼저 쓰면 업로드가
  // 끝나는 순간 src 가 갈아끼워지면서 영상 자리가 한 번 비고 기준 길이까지 흔들린다.
  const src = input.videoUrl ?? input.playbackUrl;
  return {
    kind: "setup",
    step: waitingForCoach ? 3 : input.videoFile ? 2 : 1,
    sceneLocked: waitingForCoach,
    video: src
      ? {
          kind: "player",
          src,
          caption:
            input.mode === "uploading"
              ? UPLOADING_CAPTION
              : input.videoFile?.name ?? UPLOADED_CAPTION,
          reselectable: input.mode === "prep",
        }
      : input.mode === "prep"
        ? { kind: "upload-zone" }
        : { kind: "none" },
    footer:
      input.mode === "uploading"
        ? { kind: "progress", phase: "upload" }
        : input.mode === "preparing"
          ? { kind: "progress", phase: "scan", failed: input.analysisStatus === "failed" }
          : { kind: "start", ready: input.videoFile !== null },
    continueBanner: input.continueFrom
      ? { label: input.continueFrom.label, dismissible: input.mode === "prep" }
      : null,
  };
}

function describeStatusChip(input: WorkspaceViewInput): WorkspaceStatusChip | null {
  switch (input.mode) {
    case "prep":
    case "blockage":
      return null;
    case "uploading":
      return "uploading";
    case "preparing":
      return "preparing";
    // 대화가 끝나도 노트로 넘어가기 전까지는 대화 화면이다. 그동안 "대화 중"이라고
    // 하면 화면과 어긋나므로 끝났다고 말한다.
    case "chat":
      return input.coachDone ? "chat-done" : "chat";
    case "note":
      return "note";
  }
}
