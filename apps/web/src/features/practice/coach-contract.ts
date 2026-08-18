import type {
  CoachTurnResponse,
  PracticeReport,
  PracticeSessionStatus,
  SavedPracticeReport,
} from "@/lib/api/v2/types";

export type CoachStartResult = "waiting" | "failed" | "started";

export type CoachStartCoordinator = {
  update: (status: PracticeSessionStatus) => Promise<CoachStartResult>;
  startWithoutEvidence: () => Promise<CoachStartResult>;
};

export function createCoachStartCoordinator(
  start: () => Promise<void>,
): CoachStartCoordinator {
  let started = false;
  let pending: Promise<CoachStartResult> | null = null;

  const startOnce = (): Promise<CoachStartResult> => {
    if (started) return Promise.resolve("started");
    if (pending) return pending;

    pending = Promise.resolve()
      .then(start)
      .then(() => {
        started = true;
        return "started" as const;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };

  return {
    update(status) {
      if (status === "analyzed") return startOnce();
      return Promise.resolve(status === "failed" ? "failed" : "waiting");
    },
    startWithoutEvidence: startOnce,
  };
}

export function completedCoachReport(
  turn: CoachTurnResponse,
): PracticeReport | null {
  return turn.status === "complete" ? turn.report : null;
}

export function coachMessageText(
  turn: CoachTurnResponse,
): string {
  return turn.message;
}

/**
 * 답을 보낼 수 있는가. 묻는 것이 둘로 줄었다.
 *
 * 훑어보기가 끝났는지는 여기서 묻지 않는다 — 끝나기 전에는 대화창 자체가 그려지지
 * 않기 때문이다(`workspace-view.ts` 가 그 자리에 훑어보기 화면을 세운다).
 * 대화가 끝났는지도 묻지 않는다 — `coachReady` 가 "코치가 붙었고 아직 대화 중" 을
 * 뜻하므로 끝난 대화는 이미 거짓이다.
 */
export function isCoachInputEnabled({
  coachReady,
  sending,
}: {
  coachReady: boolean;
  sending: boolean;
}): boolean {
  return coachReady && !sending;
}

export function renderablePracticeReport(
  report: PracticeReport,
): SavedPracticeReport | null {
  return report.report_type === "blocked" ? null : report;
}
