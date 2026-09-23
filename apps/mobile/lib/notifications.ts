import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

import { api } from './api';
import { createNotificationSync } from './notification-sync';
import {
  NUDGE_BODY,
  NUDGE_TITLE,
  legacyOptOutPatch,
  localDayKey,
  notificationEffects,
  parseNotificationSettings,
  permissionPrompt,
  registrablePlatform,
  type NotificationSettings,
} from './push-policy';
import { createPushTokenLifecycle } from './push-token-lifecycle';
import { LAST_PRACTICE_KEY, createReminderSchedule, type IsCurrent } from './reminder-schedule';

export * from './push-policy';

/**
 * 알림(account.notification) — 서버가 보내는 푸시 둘(분석 완료, 챌린지 활동)과 폰이 스스로
 * 울리는 저녁 리마인드.
 *
 * 토글 셋은 서버의 프로필에 저장돼 폰을 바꿔도 유지된다. 이 폰의 Expo push token 은 게이트를
 * 통과한 뒤와 앱을 열 때 서버(POST /v2/push-tokens)에 맡긴다 — 등록은 보호 기능이라 동의와
 * 프로필이 끝나기 전에는 서버가 받지 않는다. 리마인드는 서버 없이 기기에서 앞으로 30일치를
 * 예약한다 — 그날 연습이 없으면 밤 10시에 한 번(push-policy.ts).
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

/** 'acttub.' 접두사 — 탈퇴 시 local-account-data 가 이 접두사를 통째로 지운다. */
const SETTINGS_KEY = 'acttub.push.settings';
/** 1.0.0 이전의 기기 토글. 한 번 서버로 옮기고 지운다(legacyOptOutPatch). */
const LEGACY_ENABLED_KEY = 'acttub.push.enabled';

const pushTokens = createPushTokenLifecycle({
  storage: AsyncStorage,
  api: {
    register: (token, platform) => api.registerPushToken(token, platform),
    unregister: (token) => api.unregisterPushToken(token),
  },
});

/** 맞추기와 취소를 한 줄로 세운다(reminder-schedule). 모듈이 없는 빌드에서는 부르지 않는다. */
const reminders = createReminderSchedule({
  storage: AsyncStorage,
  scheduler: {
    schedule: (date) =>
      notifications!.scheduleNotificationAsync({
        content: { title: NUDGE_TITLE, body: NUDGE_BODY },
        trigger: { type: notifications!.SchedulableTriggerInputTypes.DATE, date },
      }),
    cancel: (id) => notifications!.cancelScheduledNotificationAsync(id),
    cancelAll: () => notifications!.cancelAllScheduledNotificationsAsync(),
  },
  now: () => new Date(),
});

/** 계정 세대와 동기화의 순서(notification-sync). 로그아웃이 진행 중인 동기화를 무효로 한다. */
const notificationSync = createNotificationSync({
  loadSettings: (isCurrent) => loadNotificationSettings(isCurrent),
  cachedSettings,
  registerDevice: registerThisDevice,
  forgetToken: () => pushTokens.forget(),
  flushPendingDeletions: () => pushTokens.flushPending().catch(() => undefined),
  reminders: { sync: syncDailyNudge, cancelAll: cancelScheduledReminders },
  now: () => Date.now(),
});

/**
 * 포그라운드에서도 알림을 배너로 보여준다. 앱 기동 시 한 번 부른다.
 * 모듈이 없으면 아무 일도 하지 않는다.
 */
export function configureNotificationHandling(): void {
  if (!notifications) return;
  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
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
export function onPushTapped(listener: (data: unknown) => void): () => void {
  if (!notifications) return () => undefined;
  const subscription = notifications.addNotificationResponseReceivedListener((event) => {
    listener(event?.notification?.request?.content?.data ?? null);
  });
  return () => subscription.remove();
}

/** 기기에 적어 둔 마지막 서버 값. 서버를 못 읽을 때(오프라인)와 연습 완료 때 쓴다. */
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
 * 서버의 토글 셋을 읽는다. 1.0.0 이전에 기기에서 알림을 꺼 둔 사람은 그 선택을 먼저 서버로
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
      permission = await notifications.requestPermissionsAsync();
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
 * 서버의 토글을 읽어 이 폰의 토큰 등록과 리마인드 30일치를 현재 상태에 맞춘다.
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
 * 푸시 토글 둘이 다 꺼지면 토큰 기록을 버리고, 하나를 다시 켜면 다시 등록하고, 리마인드는
 * 알람을 맞추거나 전부 취소한다.
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
      blocked = !(await notifications.requestPermissionsAsync()).granted;
    } else if (prompt === 'open_settings') {
      blocked = true;
    }
  }

  const settings = await api.updateNotificationSettings({ [key]: value });
  await cacheSettings(settings);
  const effects = notificationEffects(previous, settings);
  if (effects.forgetToken) await pushTokens.forget();
  if (effects.registerToken) await registerThisDevice({ askPermission: true, isCurrent });
  if (effects.scheduleReminders || effects.cancelReminders) await syncDailyNudge(settings, isCurrent);
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
 * 연습을 마쳤을 때 부른다 — 오늘을 기록하고 리마인드를 내일부터로 다시 깐다(오늘 것만 끈다).
 */
export async function markPracticedToday(): Promise<void> {
  const isCurrent = notificationSync.guard();
  try {
    await AsyncStorage.setItem(LAST_PRACTICE_KEY, localDayKey(new Date()));
  } catch {
    // 기록을 못 해도 리마인드가 한 번 더 올 뿐이다.
  }
  await syncDailyNudge(await cachedSettings(), isCurrent);
}

/**
 * 저녁 리마인드를 현재 상태에 맞게 다시 깐다. 게이트 통과·앱 열기·연습 완료·토글에서 부른다.
 * 순서와 "도중에 계정이 떠나면 멈춘다"는 reminder-schedule 이 정한다.
 */
async function syncDailyNudge(settings: NotificationSettings, isCurrent: IsCurrent): Promise<void> {
  if (!notifications) return;
  await reminders.sync(settings, isCurrent);
}

async function cancelScheduledReminders(): Promise<void> {
  if (!notifications) return;
  await reminders.cancelAll();
}

/**
 * 예약된 리마인드를 전부 취소한다. 로그아웃·탈퇴·세션 끊김에서 부른다. 진행 중인 동기화를 무효로
 * 한 뒤에 취소하므로, 30일치를 맞추던 중이어도 취소가 마지막에 끝난다(notification-sync).
 */
export function cancelReminders(): Promise<void> {
  return notificationSync.leave();
}
