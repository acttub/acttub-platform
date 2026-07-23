export type CoachInputState = {
  text: string;
  waiting: boolean;
  done: boolean;
  coachSessionId: string | null;
};

export function canSendCoachMessage(state: CoachInputState): boolean {
  return Boolean(
    state.text.trim() &&
    !state.waiting &&
    !state.done &&
    state.coachSessionId,
  );
}

export type CoachStartResult<T> =
  | { ok: true; response: T }
  | { ok: false; message: string };

export async function attemptCoachStart<T>(
  summaryId: string,
  start: (summaryId: string) => Promise<T>,
): Promise<CoachStartResult<T>> {
  try {
    return { ok: true, response: await start(summaryId) };
  } catch {
    return {
      ok: false,
      message: '코치 연결에 실패했어요. 다시 시도해주세요.',
    };
  }
}
