/**
 * 푸시 알림의 순수 규칙 — 네이티브 모듈 없이 성립하는 부분만 여기 산다.
 * (notifications.ts 가 expo-notifications 와 함께 이것을 소비한다. node 테스트는
 * RN 모듈을 로드할 수 없어 이 파일만 검사한다.)
 */

/**
 * 데일리 넛지(SOMA-444) — 그날 연습이 없으면 저녁 8시에 한 번 알린다.
 * 예전의 "마지막 연습 + 3일" 리마인드를 대체한다(2026-08-25, 류지성 결정).
 */
export const NUDGE_HOUR = 20;
export const NUDGE_TITLE = '오늘 연습 아직이에요';
export const NUDGE_BODY = '5분이면 돼요. 장면 하나만 찍어볼까요?';

/**
 * 로컬 알림은 반복 트리거로 "오늘만 건너뛰기" 를 할 수 없어, 앞으로 며칠치를
 * 낱개로 예약해 두고 연습·앱 실행 때마다 다시 깐다. 이 날수만큼 앱을 안 열면
 * 넛지도 멈춘다 — 무한히 조르는 것보다 낫다.
 */
export const NUDGE_WINDOW_DAYS = 7;

/** 기기 로컬 기준 'YYYY-MM-DD'. 같은 날 연습했는지 비교하는 열쇠다. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function practicedToday(lastPracticeDay: string | null, now: Date): boolean {
  return lastPracticeDay === localDayKey(now);
}

/**
 * 넛지가 울릴 시각들. 오늘 연습을 안 했고 아직 저녁 8시 전이면 오늘 8시부터,
 * 그 외에는 내일 8시부터 windowDays개.
 */
export function nudgeFireDates(
  now: Date,
  didPracticeToday: boolean,
  windowDays: number = NUDGE_WINDOW_DAYS,
): Date[] {
  const first = new Date(now);
  first.setHours(NUDGE_HOUR, 0, 0, 0);
  if (didPracticeToday || first.getTime() <= now.getTime()) {
    first.setDate(first.getDate() + 1);
  }
  const out: Date[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * 설정 화면 토글의 기본값 — 한 번도 고른 적 없으면(null) 켜짐으로 간주한다.
 * 명시적으로 'false' 를 저장했을 때만 꺼짐이다.
 */
export function parseEnabled(raw: string | null): boolean {
  return raw !== 'false';
}

/** 서버 계약(allowableValues: ios·android)에 맞는 플랫폼만 등록을 시도한다. */
export function registrablePlatform(os: string): 'ios' | 'android' | null {
  if (os === 'ios' || os === 'android') return os;
  return null;
}
