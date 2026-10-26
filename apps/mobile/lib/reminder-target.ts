const PRACTICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 누른 푸시가 열 화면. 기존 판 리마인드는 홈으로, 마저 하기 알림과 분석 완료 알림은 서버가 권한을 확인하는
 * 해당 회차로 간다. 다른 푸시는 null(부르는 쪽이 따로 처리한다).
 */
export function reminderTarget(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const practice = typeof d.practice_id === 'string' && PRACTICE_ID.test(d.practice_id)
    ? '/coach?practiceId=' + encodeURIComponent(d.practice_id)
    : null;
  if (d.kind === 'analysis_complete') return practice;
  if (d.kind !== 'evening_reminder') return null;
  if (d.reminder_kind === 'resume' && practice) return practice;
  return '/(tabs)';
}
