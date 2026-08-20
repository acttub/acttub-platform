import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { api } from './api';
import {
  REMINDER_BODY,
  REMINDER_TITLE,
  parseEnabled,
  registrablePlatform,
  reminderDelaySeconds,
} from './push-policy';

export * from './push-policy';

/**
 * 푸시 알림 — 분석 완료 푸시(서버 발송)와 연습 리마인드(로컬 스케줄).
 *
 * 분석은 수 분 걸리고 그동안 앱을 떠나면 끝났음을 알 길이 없다. 로그인하면 이 단말의
 * Expo push token 을 서버(POST /v2/push-tokens)에 맡기고, 분석이 완료되면 서버가
 * "질문이 준비됐어요" 를 보낸다. 리마인드는 서버 없이 기기에서 며칠 뒤로 예약한다.
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
const ENABLED_KEY = 'acttub.push.enabled';
const TOKEN_KEY = 'acttub.push.token';
const REMINDER_ID_KEY = 'acttub.push.reminderId';

export async function isPushEnabled(): Promise<boolean> {
  return parseEnabled(await AsyncStorage.getItem(ENABLED_KEY));
}


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
 * 이 단말의 토큰을 서버에 등록한다. 로그인 직후와 앱 기동 시(로그인 상태면) 부른다.
 *
 * 시뮬레이터·권한 거부·모듈 없음·서버 오류 — 전부 조용히 끝낸다. 등록이 안 된 단말은
 * 분석 완료를 푸시로 못 받을 뿐, 앱을 열면 홈이 이어서 안내한다.
 */
export async function syncPushRegistration(): Promise<void> {
  if (!notifications) return;
  const platform = registrablePlatform(Platform.OS);
  if (!platform) return;
  if (device && !device.isDevice) return; // 시뮬레이터는 푸시 토큰이 없다
  if (!(await isPushEnabled())) return;
  try {
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return;
    const token = (await notifications.getExpoPushTokenAsync()).data;
    if (!token) return;
    await api.registerPushToken(token, platform);
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 최선 노력 — 다음 로그인·기동에서 다시 시도한다.
  }
}

/** 알림 토글 끔: 서버에서 이 단말을 지우고 리마인드도 취소한다. */
export async function disablePush(): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, 'false');
  await cancelReminder();
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    try {
      await api.unregisterPushToken(token);
    } catch {
      // 서버가 못 지웠어도 다음 로그인에서 소유자 upsert 가 바로잡는다.
    }
  }
}

/** 알림 토글 켬: 등록을 다시 시도한다. */
export async function enablePush(): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, 'true');
  await syncPushRegistration();
}

/**
 * 로그아웃·탈퇴 직전에 부른다 — 세션이 살아 있어야 서버 해제가 인증을 통과한다.
 * 로컬 설정(켬/끔 선택)은 남긴다. 지우는 것은 단말-계정 연결뿐이다.
 */
export async function detachPushFromAccount(): Promise<void> {
  await cancelReminder();
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await AsyncStorage.removeItem(TOKEN_KEY);
  try {
    await api.unregisterPushToken(token);
  } catch {
    // 탈퇴라면 서버가 어차피 전부 지운다. 로그아웃이라면 다음 사용자의 등록이 덮는다.
  }
}

/**
 * 연습 리마인드를 지금부터 3일 뒤로 다시 건다. 연습(업로드)이 끝날 때마다 불러서
 * "마지막 연습 + 3일" 을 유지한다. 이전 예약은 취소한다 — 겹치면 두 번 울린다.
 */
export async function rescheduleReminder(): Promise<void> {
  if (!notifications) return;
  if (!(await isPushEnabled())) return;
  try {
    await cancelReminder();
    const id = await notifications.scheduleNotificationAsync({
      content: { title: REMINDER_TITLE, body: REMINDER_BODY },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: reminderDelaySeconds(),
      },
    });
    await AsyncStorage.setItem(REMINDER_ID_KEY, id);
  } catch {
    // 리마인드는 부가 기능 — 실패해도 흐름을 막지 않는다.
  }
}

async function cancelReminder(): Promise<void> {
  if (!notifications) return;
  const id = await AsyncStorage.getItem(REMINDER_ID_KEY);
  if (!id) return;
  await AsyncStorage.removeItem(REMINDER_ID_KEY);
  try {
    await notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // 이미 울렸거나 없는 예약 — 무시.
  }
}
