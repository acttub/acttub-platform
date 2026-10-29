const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 연습 알림 가운데 앱이 대상 화면을 찾아 여는 종류(SOMA-862). 찾지 못하면 /reminder-open 이 홈으로 보낸다. */
export type ReminderOpenKind = 'homework' | 'pending_video' | 'unread_script';

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function openPath(kind: ReminderOpenKind, id: string): string {
  return `/reminder-open?kind=${kind}&id=${encodeURIComponent(id)}`;
}

/**
 * 누른 푸시가 열 화면. 마저 하기 알림과 분석 완료 알림은 서버가 권한을 확인하는 해당 회차로 간다.
 * 연습 알림은 알림이 말한 것을 바로 연다(SOMA-862): 숙제는 그 묶음의 다음 테이크, 안 쓴 영상은 그 영상으로
 * 새 연습, 안 읽은 대본은 그 대본의 리딩 준비, 첫 연습은 예시 대본 고르기. 대상 id 가 없거나 다른 종류면 홈이다.
 * 옛 앱 판은 kind=evening_reminder 만 보고 홈으로 가므로 서버는 kind 를 바꾸지 않는다.
 * 다른 푸시는 null(부르는 쪽이 따로 처리한다).
 */
export function reminderTarget(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const practiceId = uuid(d.practice_id);
  const practice = practiceId ? '/coach?practiceId=' + encodeURIComponent(practiceId) : null;
  if (d.kind === 'analysis_complete') return practice;
  if (d.kind !== 'evening_reminder') return null;
  switch (d.reminder_kind) {
    case 'resume':
      return practice ?? '/(tabs)';
    case 'homework':
      return practiceId ? openPath('homework', practiceId) : '/(tabs)';
    case 'pending_video': {
      const videoId = uuid(d.video_id);
      return videoId ? openPath('pending_video', videoId) : '/(tabs)';
    }
    case 'unread_script': {
      const scriptId = uuid(d.script_id);
      return scriptId ? openPath('unread_script', scriptId) : '/(tabs)';
    }
    case 'first_practice':
    case 'first_nudge':
      return '/reading/sample';
    default:
      return '/(tabs)';
  }
}

/** 연습 알림을 눌렀을 때 남길 계측 값. 연습 알림이 아니면 null. */
export function reminderOpenEvent(data: unknown): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'evening_reminder') return null;
  const target = reminderTarget(data) ?? '';
  return {
    reminder_kind: typeof d.reminder_kind === 'string' ? d.reminder_kind.slice(0, 40) : 'unknown',
    template_id: typeof d.template_id === 'string' ? d.template_id.slice(0, 60) : '',
    target: target.startsWith('/reminder-open') ? 'resolve' : target === '/(tabs)' ? 'home' : target.split('?')[0],
  };
}

export function isReminderOpenKind(value: unknown): value is ReminderOpenKind {
  return value === 'homework' || value === 'pending_video' || value === 'unread_script';
}
