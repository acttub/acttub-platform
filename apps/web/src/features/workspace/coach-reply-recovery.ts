import { ApiError, NetworkError } from "@/lib/api/v2/errors";
import type { PracticeReport } from "./workspace-state";

export function isClosedCoach(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
    // conversation_closed 는 1.0.0 의 코드이고 앞의 둘은 옛 코치 경로가 쓰던 말이다.
    && (error.code === "session is closed" || error.code === "session_closed" || error.code === "conversation_closed");
}

export function coachReplyError(error: unknown): string {
  if (error instanceof ApiError && error.code === "coach_response_unavailable") return "코치의 답변을 준비하지 못했어요. 입력한 답은 보관했으니 다시 보내 주세요.";
  if (error instanceof NetworkError) return "응답을 받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.";
  if (error instanceof ApiError && error.status === 429) return "요청이 많아 잠시 기다려야 해요. 조금 뒤 다시 보내 주세요.";
  return "답변을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/** Lock the completed conversation before awaiting its note; never restart it on lookup failure. */
export async function recoverClosedCoach({ isCurrent, close, load, restore, unavailable }: {
  isCurrent: () => boolean;
  close: () => void;
  /** 노트가 없는 대화도 있다(짧게 끝난 기존 갈래) — 그때는 report 가 null 이다. */
  load: () => Promise<{ report: PracticeReport | null }>;
  restore: (report: PracticeReport | null) => void;
  unavailable: () => void;
}): Promise<void> {
  if (!isCurrent()) return;
  close();
  try {
    const { report } = await load();
    if (isCurrent()) restore(report);
  } catch {
    if (isCurrent()) unavailable();
  }
}
