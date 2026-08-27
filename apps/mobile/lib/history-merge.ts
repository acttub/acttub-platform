/**
 * 연습 기록 병합 (SOMA-444) — 웹과 같은 그림.
 * 정리(리포트)가 있는 연습은 리포트 카드로, 아직 정리가 없는 연습(분석 중·실패·
 * 대화가 짧게 끝난 세션)도 목록에서 사라지지 않게 세션 카드로 함께 보여준다.
 * 서버 호출은 화면이 하고, 여기는 섞고 정렬하는 순수 로직만 든다.
 */

import { translate } from './i18n.ts';

export type HistoryReportLike = { practice_session_id: string; created_at: string };
export type HistorySessionLike = { session_id: string; created_at: string };

export type HistoryEntry<R extends HistoryReportLike, S extends HistorySessionLike> =
  | { kind: 'report'; createdAt: string; report: R }
  | { kind: 'session'; createdAt: string; session: S };

export function mergeHistory<R extends HistoryReportLike, S extends HistorySessionLike>(
  sessions: S[],
  reports: R[],
): HistoryEntry<R, S>[] {
  const reported = new Set(reports.map((r) => r.practice_session_id));
  const entries: HistoryEntry<R, S>[] = [
    ...reports.map((report) => ({ kind: 'report' as const, createdAt: report.created_at, report })),
    ...sessions
      .filter((s) => !reported.has(s.session_id))
      .map((session) => ({ kind: 'session' as const, createdAt: session.created_at, session })),
  ];
  // 최신이 위로. 같은 시각이면 리포트를 먼저 — 정리된 쪽이 더 많은 정보를 준다.
  return entries.sort((a, b) => {
    const t = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (t !== 0) return t;
    if (a.kind === b.kind) return 0;
    return a.kind === 'report' ? -1 : 1;
  });
}

/** 세션 카드 제목 — 장면 메모가 없으면 대신 붙일 이름. */
export function sessionCardTitle(situation: string | null | undefined): string {
  const t = situation?.trim();
  return t || translate('history.noSceneTitle');
}
