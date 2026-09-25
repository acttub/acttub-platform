/** 회차·영상 응답을 워크스페이스의 화면 상태로 옮긴다. */
import type { components } from "@/lib/api/v2-schema";
import type { PracticeSessionStatus } from "@/lib/api/v2/types";
import type { Practice, PracticeAnalysis, Video } from "@/lib/practice/api-types";
import type { BlockageKind } from "./blockage-flow";
import { sessionStatusOf } from "./practice-analysis";

export interface PracticeDetailView {
  session_id: string;
  status: PracticeSessionStatus;
  situation: string;
  character_context: string;
  goal: string;
  blockage_kind: BlockageKind;
  sub_branch: string;
  blockage_detail: string | null;
  created_at: string;
  playback_url: string;
  summary: components["schemas"]["ObservationPackResponse"] | components["schemas"]["VideoRecordSummaryResponse"] | null;
  error_code: "gemini_timeout" | "gemini_parse_error" | "unsupported_media" | "max_attempts_exceeded" | null;
  root_id: string;
  ordinal: number;
  video_id: string | null;
  video_purged: boolean;
  analysis_status: string | null;
  stage: Practice["stage"];
  previous_conversations: Practice["previous_conversations"];
}

export function practiceToSessionDetail(practice: Practice & { video?: Video | null; analysis?: PracticeAnalysis | null }): PracticeDetailView {
  const status = sessionStatusOf(practice);
  return {
    session_id: practice.id,
    status,
    situation: practice.situation,
    character_context: practice.character,
    goal: practice.goal,
    blockage_kind: practice.blockage_category === "분석" || practice.blockage_category === "표현" ? practice.blockage_category : "그 외",
    sub_branch: practice.blockage_detail,
    blockage_detail: practice.blockage_note ?? null,
    created_at: practice.created_at,
    playback_url: practice.video?.playback_url ?? "",
    summary: practice.analysis?.summary ?? null,
    error_code: status === "failed" ? toErrorCode(practice.job?.failure_reason ?? null) : null,
    root_id: practice.root_id,
    ordinal: practice.ordinal,
    video_id: practice.video_id,
    video_purged: !practice.video_id || Boolean(practice.video?.purged_at),
    analysis_status: practice.analysis_status ?? null,
    stage: practice.stage,
    previous_conversations: practice.previous_conversations ?? [],
  };
}

function toErrorCode(reason: string | null): PracticeDetailView["error_code"] {
  switch (reason) {
    case "timeout": return "gemini_timeout";
    case "parse": return "gemini_parse_error";
    case "unsupported": return "unsupported_media";
    case null: return null;
    default: return "max_attempts_exceeded";
  }
}
