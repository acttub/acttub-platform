import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

import { api } from './api';
import { createNotificationSync, type IsCurrent } from './notification-sync';
import {
  legacyOptOutPatch,
  notificationEffects,
  parseNotificationSettings,
  permissionPrompt,
  registrablePlatform,
  type NotificationSettings,
} from './push-policy';
import { createPushOpenRecorder, pushOpenRecord } from './push-open';
import { createPushTokenLifecycle } from './push-token-lifecycle';

export { pushOpenRecord };

export * from './push-policy';

/**
 * 알림(account.notification) — 서버가 보내는 푸시 셋(분석 완료, 챌린지 활동, 저녁 리마인드).
 *
 * 토글 셋은 서버의 프로필에 저장돼 폰을 바꿔도 유지된다. 이 폰의 Expo push token 은 게이트를
 * 통과한 뒤와 앱을 열 때 서버(POST /v2/push-tokens)에 맡긴다 — 등록은 보호 기능이라 동의와
 * 프로필이 끝나기 전에는 서버가 받지 않는다. 업데이트 뒤에는 옛 앱이 남긴 로컬 리마인드를 취소하고,
 * 서버가 한국 날짜의 활동을 확인해 저녁 8시에 보낸다.
 *
 * expo-notifications 는 네이티브 모듈이라 예전 빌드(0.0.4 이하)에는 없다 — google 로그인
 * 모듈과 같은 방식으로 조용히 조건 로딩한다. 모듈이 없으면 모든 함수가 아무 일도 하지
 * 않는다: 알림은 최선 노력이고, 없다고 앱이 죽으면 안 된다.
 */
type NotificationsModule = typeof import('expo-notifications');
let notifications: NotificationsModule | null = null;
try {
  notifications = require('expo-notifications');
} catch {
  notifications = null;
}

let device: typeof import('expo-device') | null = null;
try {
  device = require('expo-device');
} catch {
  device = null;
}

/** 안드로이드 13+ 는 알림 채널이 하나라도 있어야 권한 창을 띄운다. 채널 없이 묻으면 창이 안 뜬다. */
export const DEFAULT_ANDROID_CHANNEL_ID = 'default';

/**
 * OS 알림 권한을 묻는다. 안드로이드에서는 묻기 전에 기본 채널을 먼저 만든다 —
 * 채널이 없으면 POST_NOTIFICATIONS 창이 뜨지 않고 권한이 영영 거부 상태로 남는다.
 */
async function requestOsPermission(
  module: NotificationsModule,
): Promise<Awaited<ReturnType<NotificationsModule['requestPermissionsAsync']>>> {
  if (Platform.OS === 'android') {
    await module
      .setNotificationChannelAsync(DEFAULT_ANDROID_CHANNEL_ID, {
        name: 'default',
        importance: module.AndroidImportance.DEFAULT,
      })
      .catch(() => undefined);
  }
  return module.requestPermissionsAsync();
}

/** 'acttub.' 접두사 — 탈퇴 시 local-account-data 가 이 접두사를 통째로 지운다. */
const SETTINGS_KEY = 'acttub.push.settings';
/** 0.1.0 이전의 기기 토글. 한 번 서버로 옮기고 지운다(legacyOptOutPatch). */
const LEGACY_ENABLED_KEY = 'acttub.push.enabled';
/** 옛 판이 로컬 리마인드의 예약 id 를 적어 두던 자리. 리마인드를 걷을 때 같이 지운다. */
const LEGACY_NUDGE_IDS_KEY = 'acttub.push.nudgeIds';

const pushTokens = createPushTokenLifecycle({
  storage: AsyncStorage,
  api: {
    register: (token, platform) => api.registerPushToken(token, platform),
    unregister: (token) => api.unregisterPushToken(token),
  },
});

/** 계정 세대와 동기화의 순서(notification-sync). 로그아웃이 진행 중인 동기화를 무효로 한다. */
const notificationSync = createNotificationSync({
  loadSettings: (isCurrent) => loadNotificationSettings(isCurrent),
  cachedSettings,
  registerDevice: registerThisDevice,
  forgetToken: () => pushTokens.forget(),
  flushPendingDeletions: () => pushTokens.flushPending().catch(() => undefined),
  clearLocalReminders: clearLegacyReminders,
  now: () => Date.now(),
});

/** 지금 보고 있는 화면이 숨기라고 걸어 둔 조건들. 하나라도 맞으면 그 알림은 띄우지 않는다. */
const foregroundHiders = new Set<(data: unknown) => boolean>();

/**
 * 보고 있는 화면이 같은 내용을 이미 보여 주는 알림만 앱이 떠 있을 때 숨긴다(예: 그 연습의
 * 분석 대기 화면에서 받은 분석 완료). 화면에 들어올 때 걸고, 돌려준 함수로 떠날 때 푼다.
 */
export function hideForegroundPush(match: (data: unknown) => boolean): () => void {
  foregroundHiders.add(match);
  return () => {
    foregroundHiders.delete(match);
  };
}

function shouldShowInForeground(data: unknown): boolean {
  for (const match of foregroundHiders) {
    try {
      if (match(data)) return false;
    } catch {
      // 조건이 깨져도 알림은 띄운다.
    }
  }
  return true;
}

/**
 * 앱이 떠 있을 때도 알림을 배너로 보여 준다. 다만 보고 있는 화면이 숨기라고 한 알림은 배너·목록
 * 모두 띄우지 않는다(안드로이드는 목록만 켜도 화면에 뜬다). 앱 기동 시 한 번 부른다.
 * 모듈이 없으면 아무 일도 하지 않는다.
 */
export function configureNotificationHandling(): void {
  if (!notifications) return;
  notifications.setNotificationHandler({
    handleNotification: async (notification?: { request?: { content?: { data?: unknown } } }) => {
      const show = shouldShowInForeground(notification?.request?.content?.data ?? null);
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * 앱이 떠 있는 동안 도착한 푸시를 듣는다(분석 완료). 모듈이 없으면 구독하지 않는다.
 * 푸시의 자료를 그대로 넘기고 무엇인지 가리는 것은 부르는 쪽이 한다(practice/analysis-run).
 */
export function onPushReceived(listener: (data: unknown) => void): () => void {
  if (!notifications) return () => undefined;
  const subscription = notifications.addNotificationReceivedListener((event) => {
    listener(event?.request?.content?.data ?? null);
  });
  return () => subscription.remove();
}

/**
 * 푸시를 눌러 앱이 열렸을 때. 잠금 화면 문구에는 이름·본문이 없고 알림 식별자만 있으므로
 * 그 자료로 어디를 열지 정한다(challenge.notification). 모듈이 없으면 구독하지 않는다.
 */
export function onPushTapped(
  listener: (data: unknown, identifier?: string) => void,
): () => void {
  if (!notifications) return () => undefined;
  const subscription = notifications.addNotificationResponseReceivedListener((event) => {
    listener(
      event?.notification?.request?.content?.data ?? null,
      event?.notification?.request?.identifier,
    );
  });
  return () => subscription.remove();
}

const pushOpens = createPushOpenRecorder({
  send: (body) => api.recordPushOpen(body),
  platform: () => registrablePlatform(Platform.OS),
});

/** 마지막으로 처리해 둔 콜드 스타트 탭의 알림 식별자. 같은 탭을 다음 실행에서 또 세지 않으려는 것이다. */
const LAST_COLD_START_KEY = 'device.lastPushOpenId';

/** 푸시를 눌러 연 것을 서버에 남긴다(측정). 기다리지 않고 실패는 삼키며 화면 이동에 영향이 없다. */
export function capturePushOpen(data: unknown, identifier?: string | null): void {
  try {
    pushOpens.capture(identifier, data);
    // 켜진 앱에서 센 탭도 적어 둔다. 다음 실행의 콜드 스타트 조회가 같은 탭을 또 세지 않게 한다.
    if (identifier) void AsyncStorage.setItem(LAST_COLD_START_KEY, identifier).catch(() => undefined);
  } catch {
    // 측정이 앱을 막으면 안 된다.
  }
}

/** 로그인한 회원이 생기면(또는 없어지면) 알린다. 켜지는 순간 로그인 전에 눌린 탭을 보낸다. */
export function setPushOpenSignedIn(signedIn: boolean): void {
  pushOpens.setSignedIn(signedIn);
}


/**
 * 꺼진 앱을 푸시로 연 경우 리스너가 붙기 전에 탭이 지나갔을 수 있다. 앱을 처음 띄울 때 한 번 마지막 탭을
 * 조회해 남긴다. 이미 남긴 식별자(저장해 둔 것)는 건너뛴다. 화면 이동은 건드리지 않는다.
 */
export async function recordColdStartPushOpen(): Promise<void> {
  if (!notifications?.getLastNotificationResponseAsync) return;
  try {
    const last = await notifications.getLastNotificationResponseAsync();
    const identifier = last?.notification?.request?.identifier;
    if (!last || !identifier) return;
    if ((await AsyncStorage.getItem(LAST_COLD_START_KEY).catch(() => null)) === identifier) return;
    await AsyncStorage.setItem(LAST_COLD_START_KEY, identifier).catch(() => undefined);
    capturePushOpen(last.notification.request.content?.data ?? null, identifier);
  } catch {
    // 조회 실패는 삼킨다.
  }
}

/** 기기에 적어 둔 마지막 서버 값. 서버를 못 읽을 때(오프라인) 쓴다. */
async function cachedSettings(): Promise<NotificationSettings> {
  try {
    return parseNotificationSettings(await AsyncStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseNotificationSettings(null);
  }
}

async function cacheSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => undefined);
}

/**
 * 서버의 토글 셋을 읽는다. 0.1.0 이전에 기기에서 알림을 꺼 둔 사람은 그 선택을 먼저 서버로
 * 옮긴다 — 업데이트했다고 서버 기본값(모두 켜짐)으로 알림을 받기 시작하면 안 된다.
 *
 * 응답을 기다리는 사이 계정이 떠났으면(isCurrent 가 거짓) 읽은 값을 기기에 적지 않는다.
 */
export async function loadNotificationSettings(
  isCurrent: IsCurrent = () => true,
): Promise<NotificationSettings> {
  const legacy = legacyOptOutPatch(await AsyncStorage.getItem(LEGACY_ENABLED_KEY).catch(() => null));
  const settings = legacy
    ? await api.updateNotificationSettings(legacy)
    : await api.notificationSettings();
  if (!isCurrent()) return settings;
  await AsyncStorage.removeItem(LEGACY_ENABLED_KEY).catch(() => undefined);
  await cacheSettings(settings);
  return settings;
}

/**
 * 이 단말의 토큰을 서버에 등록한다. 게이트를 통과한 뒤와 앱을 열 때 부른다.
 *
 * 시뮬레이터·권한 거부·모듈 없음·서버 오류 — 전부 조용히 끝낸다. 등록이 안 된 단말은
 * 푸시를 못 받을 뿐, 앱을 열면 홈이 이어서 안내한다. 등록에 성공하면 밀린 삭제를 버린다.
 *
 * 배경 복귀 때는 권한을 새로 묻지 않는다(askPermission=false) — 권한 창이 앱을 다시 배경으로
 * 보내 복귀가 되풀이된다. 권한 창에서 돌아왔을 때 계정이 이미 떠났으면 등록하지 않는다.
 */
async function registerThisDevice({
  askPermission,
  isCurrent,
}: {
  askPermission: boolean;
  isCurrent: IsCurrent;
}): Promise<void> {
  if (!notifications) return;
  const platform = registrablePlatform(Platform.OS);
  if (!platform) return;
  if (device && !device.isDevice) return; // 시뮬레이터는 푸시 토큰이 없다
  try {
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && askPermission) {
      permission = await requestOsPermission(notifications);
    }
    if (!permission.granted) return;
    const token = (await notifications.getExpoPushTokenAsync()).data;
    if (!token) return;
    await pushTokens.register(token, platform, isCurrent);
  } catch {
    // 최선 노력 — 다음 기동에서 다시 시도한다.
  }
}

/**
 * 게이트(동의 → 프로필)를 통과한 순간과, 게이트가 이미 끝난 회원이 앱을 켰을 때 부른다.
 * 서버의 토글을 읽어 이 폰의 토큰 등록과 남은 로컬 리마인드 취소를 현재 상태에 맞춘다.
 * 서버를 못 읽으면 기기에 적어 둔 마지막 값으로 간다. 도중에 로그아웃하면 멈춘다.
 */
export function syncNotificationsAfterGate(): Promise<void> {
  return notificationSync.afterGate();
}

/**
 * 앱이 배경에서 돌아왔을 때 부른다 — "앱을 열 때"는 새로 켤 때만이 아니다. 밀린 토큰 삭제는
 * 로그인 없이도 다시 보내고, 게이트를 통과한 계정이 있으면 최소 간격을 두고 다시 맞춘다.
 */
export function syncNotificationsOnForeground(gatePassed: boolean): Promise<void> {
  return notificationSync.onForeground({ gatePassed });
}

/**
 * 앱을 켤 때 부른다 — 로그인 여부와 무관하다. 로그아웃 때 지우지 못한 푸시 토큰을 다시
 * 보낸다. 삭제는 로그인 없이 받으므로 기기에 액세스 토큰이 없어도 된다.
 */
export async function flushPendingPushTokenDeletions(): Promise<void> {
  await pushTokens.flushPending().catch(() => undefined);
}

export type ToggleResult =
  | { kind: 'saved'; settings: NotificationSettings }
  /** OS 알림 권한이 꺼져 있고 다시 물을 수도 없다. 화면이 권한 설정으로 안내한다. */
  | { kind: 'permission_blocked'; settings: NotificationSettings };

/**
 * 설정의 토글 하나를 바꾼다. 서버에 저장한 뒤(실패하면 던진다) 이 폰이 할 일을 한다 —
 * 토글 셋이 다 꺼지면 토큰 기록을 버리고, 하나를 다시 켜면 다시 등록한다.
 */
export async function setNotificationToggle(
  previous: NotificationSettings,
  key: keyof NotificationSettings,
  value: boolean,
): Promise<ToggleResult> {
  const isCurrent = notificationSync.guard();
  let blocked = false;
  if (notifications) {
    const permission = await notifications.getPermissionsAsync();
    const prompt = permissionPrompt({
      turningOn: value,
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
    });
    if (prompt === 'request') {
      blocked = !(await requestOsPermission(notifications)).granted;
    } else if (prompt === 'open_settings') {
      blocked = true;
    }
  }

  const settings = await api.updateNotificationSettings({ [key]: value });
  await cacheSettings(settings);
  const effects = notificationEffects(previous, settings);
  if (effects.forgetToken) await pushTokens.forget();
  if (effects.registerToken) await registerThisDevice({ askPermission: true, isCurrent });
  return { kind: blocked ? 'permission_blocked' : 'saved', settings };
}

/** OS 의 이 앱 알림 설정을 연다. */
export function openNotificationPermissionSettings(): Promise<void> {
  return Linking.openSettings();
}

/**
 * 로그아웃의 첫 단계 — 이 폰의 푸시 토큰을 서버에서 지운다. 실패해도 던지지 않고 기기에 적어
 * 두었다가 다음 실행 때 다시 보낸다(push-token-lifecycle).
 *
 * 계정이 떠나기 시작하는 자리라 진행 중인 동기화부터 무효로 한다. 기기의 액세스 토큰은
 * 로그아웃의 마지막 단계까지 살아 있어, 두면 늦게 돌아온 동기화가 지운 토큰을 다시 등록한다.
 */
export function detachPushToken(): Promise<void> {
  notificationSync.invalidate();
  return pushTokens.detach();
}

/** 탈퇴 뒤 — 서버가 토큰을 전부 지웠으므로 기기의 기록만 버린다. */
export function forgetPushToken(): Promise<void> {
  notificationSync.invalidate();
  return pushTokens.forget();
}

/**
 * 옛 판이 예약한 저녁 리마인드를 전부 취소한다. 저녁 리마인드는 서버 푸시라 새로 예약하지 않고,
 * 이 앱이 예약하는 로컬 알림은 리마인드뿐이라 전부 취소해도 된다. 게이트 통과·앱 열기·계정이
 * 떠날 때 부른다(notification-sync). 모듈이 없는 빌드에서는 아무 일도 하지 않는다.
 */
async function clearLegacyReminders(): Promise<void> {
  if (!notifications) return;
  await AsyncStorage.removeItem(LEGACY_NUDGE_IDS_KEY).catch(() => undefined);
  // 「나중에 알려 주기」(upload_later) 예약은 옛 리마인드가 아니므로 지운 뒤 다시 걸어 둔다.
  const kept = ((await notifications.getAllScheduledNotificationsAsync?.().catch(() => [])) ?? []).filter(
    (item) => (item.content?.data as { kind?: string } | undefined)?.kind === UPLOAD_LATER_KIND,
  );
  await notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  for (const item of kept) {
    await notifications
      .scheduleNotificationAsync({ content: item.content as never, trigger: item.trigger as never })
      .catch(() => undefined);
  }
}

const UPLOAD_LATER_KIND = 'upload_later';

/**
 * 「지금은 못 찍어요」(P3.25) — 내일 저녁 8시에 로컬 알림 하나를 예약한다. 이미 예약한 것은 지우고 다시 건다.
 * 권한이 없으면 한 번 묻고, 거절하면 'denied'. 모듈이 없는 빌드는 'unavailable'.
 */
export async function scheduleUploadLaterReminder(
  title: string,
  body: string,
  now: Date = new Date(),
): Promise<'scheduled' | 'denied' | 'unavailable'> {
  if (!notifications) return 'unavailable';
  try {
    let status = (await notifications.getPermissionsAsync()).status;
    if (status !== 'granted') status = (await requestOsPermission(notifications)).status;
    if (status !== 'granted') return 'denied';
    const existing = (await notifications.getAllScheduledNotificationsAsync?.()) ?? [];
    for (const item of existing) {
      if ((item.content?.data as { kind?: string } | undefined)?.kind === UPLOAD_LATER_KIND) {
        await notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined);
      }
    }
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(20, 0, 0, 0);
    await notifications.scheduleNotificationAsync({
      content: { title, body, data: { kind: UPLOAD_LATER_KIND } },
      trigger: { type: notifications.SchedulableTriggerInputTypes.DATE, date },
    });
    return 'scheduled';
  } catch {
    return 'unavailable';
  }
}

/**
 * 옛 로컬 리마인드를 전부 취소한다. 로그아웃·탈퇴·세션 끊김에서 부른다. 진행 중인 동기화를
 * 무효로 한 뒤에 취소한다(notification-sync).
 */
export function cancelReminders(): Promise<void> {
  return notificationSync.leave();
}
