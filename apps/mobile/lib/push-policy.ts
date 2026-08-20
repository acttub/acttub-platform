/**
 * 푸시 알림의 순수 규칙 — 네이티브 모듈 없이 성립하는 부분만 여기 산다.
 * (notifications.ts 가 expo-notifications 와 함께 이것을 소비한다. node 테스트는
 * RN 모듈을 로드할 수 없어 이 파일만 검사한다.)
 */

/** 연습 리마인드까지의 간격. 3일 정도가 "잊었다" 와 "귀찮다" 사이다. */
export const REMINDER_AFTER_DAYS = 3;

export const REMINDER_TITLE = '연습한 지 3일이 지났어요';
export const REMINDER_BODY = '오늘 찍은 장면으로 질문을 받아볼까요?';

/**
 * 설정 화면 토글의 기본값 — 한 번도 고른 적 없으면(null) 켜짐으로 간주한다.
 * 명시적으로 'false' 를 저장했을 때만 꺼짐이다.
 */
export function parseEnabled(raw: string | null): boolean {
  return raw !== 'false';
}

/** 리마인드 예약까지 남은 초. expo 의 timeInterval 트리거 입력이다. */
export function reminderDelaySeconds(days: number = REMINDER_AFTER_DAYS): number {
  return days * 24 * 60 * 60;
}

/** 서버 계약(allowableValues: ios·android)에 맞는 플랫폼만 등록을 시도한다. */
export function registrablePlatform(os: string): 'ios' | 'android' | null {
  if (os === 'ios' || os === 'android') return os;
  return null;
}
