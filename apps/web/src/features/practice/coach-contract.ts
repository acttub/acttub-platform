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

export function isCoachInputEnabled({
  analysisStatus,
  coachSessionId,
  sending,
  done,
}: {
  analysisStatus: PracticeSessionStatus | null;
  coachSessionId: string | null;
  sending: boolean;
  done: boolean;
}): boolean {
  const analysisSettled = analysisStatus === "analyzed" || analysisStatus === "failed";
  return Boolean(analysisSettled && coachSessionId && !sending && !done);
}

export function renderablePracticeReport(
  report: PracticeReport,
): SavedPracticeReport | null {
  return report.report_type === "blocked" ? null : report;
}
