/** 기존 판은 홈으로, 마저 하기 알림은 서버가 권한을 확인하는 해당 회차로 간다. */
export function reminderTarget(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'evening_reminder') return null;
  if (d.reminder_kind === 'resume' && typeof d.practice_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.practice_id)) {
    return '/coach?practiceId=' + encodeURIComponent(d.practice_id);
  }
  return '/(tabs)';
}
