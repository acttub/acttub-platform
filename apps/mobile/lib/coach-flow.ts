import { translate } from './i18n.ts';

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
  practiceSessionId: string,
  start: (practiceSessionId: string) => Promise<T>,
): Promise<CoachStartResult<T>> {
  try {
    return { ok: true, response: await start(practiceSessionId) };
  } catch {
    return {
      ok: false,
      message: translate('coachFlow.connectFail'),
    };
  }
}

export type CoachCompletionNext = 'continue' | 'note-skipped' | 'report';

/**
 * 코치가 대화를 끝냈을 때 화면이 갈 곳.
 * - 정리(report)가 같이 왔든 안 왔든 리포트 화면으로 간다 — 안 왔으면 리포트 화면이
 *   직접 만든다(재시도·홈으로 버튼이 거기 있다). 대화 화면에 남겨 두면 배우가 갇힌다.
 * - 노트로 남기기엔 짧아 막힌(blocked) 종료만 대화 화면에 남는다.
 */
export function coachCompletionNext(reply: {
  status: 'continue' | 'complete';
  report: { report_type: string } | null;
}): CoachCompletionNext {
  if (reply.status !== 'complete') return 'continue';
  if (reply.report?.report_type === 'blocked') return 'note-skipped';
  return 'report';
}
