/**
 * 푸시 알림의 순수 규칙 — 네이티브 모듈 없이 성립하는 부분만 여기 산다.
 * (notifications.ts 가 expo-notifications 와 함께 이것을 소비한다. node 테스트는
 * RN 모듈을 로드할 수 없어 이 파일만 검사한다.)
 */

/** 알림 토글 셋. 서버의 프로필에 저장돼 폰을 바꿔도 유지된다. */
export type NotificationSettings = {
  analysis_done: boolean;
  challenge: boolean;
  evening_reminder: boolean;
};

/** 기본값은 모두 켜짐이다. 알림 권한을 허용한 사람은 설정을 건드리지 않아도 바로 받는다. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  analysis_done: true,
  challenge: true,
  evening_reminder: true,
};

/** 기기에 적어 둔 마지막 서버 값. 앱을 열 때 서버를 못 읽어도 토큰 등록을 판단할 수 있게 둔다. */
export function parseNotificationSettings(raw: string | null): NotificationSettings {
  if (!raw) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    const value = JSON.parse(raw) as Partial<NotificationSettings> | null;
    if (value === null || typeof value !== 'object') return { ...DEFAULT_NOTIFICATION_SETTINGS };
    const pick = (key: keyof NotificationSettings) =>
      typeof value[key] === 'boolean' ? value[key] : DEFAULT_NOTIFICATION_SETTINGS[key];
    return {
      analysis_done: pick('analysis_done'),
      challenge: pick('challenge'),
      evening_reminder: pick('evening_reminder'),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

/** 서버가 보내는 푸시(분석 완료·챌린지·저녁 리마인드)를 하나라도 받는가. 셋 다 꺼지면 토큰이 필요 없다. */
export function wantsServerPush(settings: NotificationSettings): boolean {
  return settings.analysis_done || settings.challenge || settings.evening_reminder;
}

/**
 * 토글이 바뀌었을 때 이 폰이 할 일.
 *
 * 토글 하나만 꺼져 있으면 토큰은 두고 서버가 보내기 전에 거른다. 셋 다 꺼지면 서버가 그 회원의
 * 토큰을 전부 지우므로 앱은 남은 기록만 버린다. 하나를 다시 켜면 이 폰의 토큰을 다시 등록한다.
 */
export function notificationEffects(
  previous: NotificationSettings,
  next: NotificationSettings,
): {
  registerToken: boolean;
  forgetToken: boolean;
} {
  return {
    registerToken: !wantsServerPush(previous) && wantsServerPush(next),
    forgetToken: wantsServerPush(previous) && !wantsServerPush(next),
  };
}

/** OS 알림 권한이 꺼져 있으면 토글을 켜도 알림이 오지 않는다. 켤 때만 권한을 챙긴다. */
export function permissionPrompt(input: {
  turningOn: boolean;
  granted: boolean;
  canAskAgain: boolean;
}): 'none' | 'request' | 'open_settings' {
  if (!input.turningOn || input.granted) return 'none';
  return input.canAskAgain ? 'request' : 'open_settings';
}

/**
 * 0.1.0 이전에는 알림 토글이 기기에만 있었다('acttub.push.enabled'). 그때 꺼 둔 사람이
 * 업데이트했다고 서버 기본값(모두 켜짐)으로 알림을 받기 시작하면 안 된다 — 한 번만 서버에 옮긴다.
 */
export function legacyOptOutPatch(rawEnabled: string | null): NotificationSettings | null {
  return rawEnabled === 'false'
    ? { analysis_done: false, challenge: false, evening_reminder: false }
    : null;
}

/** 서버 계약(allowableValues: ios·android)에 맞는 플랫폼만 등록을 시도한다. */
export function registrablePlatform(os: string): 'ios' | 'android' | null {
  if (os === 'ios' || os === 'android') return os;
  return null;
}
