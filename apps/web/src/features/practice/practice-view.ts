/**
 * 회차(Practice)를 워크스페이스 화면이 그리는 모양(옛 PracticeSessionDetail)으로 옮긴다. 대화·노트·장면 패널은
 * 그 모양을 그대로 쓰고, 회차 API 로 바뀐 것은 이 한 자리가 흡수한다. 통합(PI1)이 생성 타입으로 바꿀 때도 여기만 본다.
 */
import type { PracticeSessionDetail } from "@/lib/api/v2/types";
import type { Practice } from "@/lib/practice/api-types";
import { sessionStatusOf } from "./practice-analysis";

export type PracticeDetailView = PracticeSessionDetail & {
  /** 묶음의 첫 회차 id — 숨김·즐겨찾기·이어하기가 쓴다 */
  root_id: string;
  ordinal: number;
  video_id: string;
  /** 파일만 파기한 영상은 재생할 수 없다 */
  video_purged: boolean;
  analysis_status: "ready" | "partial" | null;
  stage: Practice["stage"];
};

export function practiceToSessionDetail(practice: Practice): PracticeDetailView {
  const status = sessionStatusOf(practice);
  const failure = practice.job?.failure_reason ?? null;
  return {
    session_id: practice.id,
    status,
    situation: practice.scene.situation,
    character_context: practice.scene.character,
    goal: practice.scene.goal,
    blockage_kind: practice.blockage.category,
    sub_branch: practice.blockage.detail,
    blockage_detail: practice.blockage.note,
    created_at: practice.created_at,
    updated_at: practice.updated_at,
    playback_url: practice.video.playback_url ?? "",
    summary: (practice.analysis?.summary ?? null) as PracticeSessionDetail["summary"],
    error_code: status === "failed" ? (toErrorCode(failure) as PracticeSessionDetail["error_code"]) : null,
    root_id: practice.root_id,
    ordinal: practice.ordinal,
    video_id: practice.video.id,
    video_purged: practice.video.purged_at !== null,
    analysis_status: practice.analysis?.status ?? null,
    stage: practice.stage,
  };
}

function toErrorCode(reason: string | null): string | null {
  switch (reason) {
    case "timeout":
      return "gemini_timeout";
    case "parse":
      return "gemini_parse_error";
    case "unsupported":
      return "unsupported_media";
    case null:
      return null;
    default:
      return "max_attempts_exceeded";
  }
}
