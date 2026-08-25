import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { api } from './api';
import {
  NUDGE_BODY,
  NUDGE_TITLE,
  localDayKey,
  nudgeFireDates,
  parseEnabled,
  practicedToday,
  registrablePlatform,
} from './push-policy';

export * from './push-policy';

/**
 * 푸시 알림 — 분석 완료 푸시(서버 발송)와 데일리 넛지(로컬 스케줄).
 *
 * 분석은 수 분 걸리고 그동안 앱을 떠나면 끝났음을 알 길이 없다. 로그인하면 이 단말의
 * Expo push token 을 서버(POST /v2/push-tokens)에 맡기고, 분석이 완료되면 서버가
 * "질문이 준비됐어요" 를 보낸다. 넛지는 서버 없이 기기에서 앞으로 며칠치를 예약한다
 * — 그날 연습이 없으면 저녁 8시에 한 번(push-policy.ts).
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
const NUDGE_IDS_KEY = 'acttub.push.nudgeIds';
const LAST_PRACTICE_KEY = 'acttub.push.lastPracticeDay';

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

/** 알림 토글 끔: 서버에서 이 단말을 지우고 넛지도 취소한다. */
export async function disablePush(): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, 'false');
  await cancelNudges();
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
  await syncDailyNudge();
}

/**
 * 로그아웃·탈퇴 직전에 부른다 — 세션이 살아 있어야 서버 해제가 인증을 통과한다.
 * 로컬 설정(켬/끔 선택)은 남긴다. 지우는 것은 단말-계정 연결뿐이다.
 */
export async function detachPushFromAccount(): Promise<void> {
  await cancelNudges();
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
 * 연습을 마쳤을 때 부른다 — 오늘을 기록하고 넛지를 내일부터로 다시 깐다.
 */
export async function markPracticedToday(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PRACTICE_KEY, localDayKey(new Date()));
  } catch {
    // 기록을 못 해도 넛지가 한 번 더 올 뿐이다.
  }
  await syncDailyNudge();
}

/**
 * 데일리 넛지를 현재 상태에 맞게 다시 깐다. 앱 기동·연습 완료·토글 켬에서 부른다.
 * 반복 트리거로는 "오늘만 건너뛰기" 가 안 되어 앞으로 며칠치를 낱개로 예약한다.
 */
export async function syncDailyNudge(): Promise<void> {
  if (!notifications) return;
  if (!(await isPushEnabled())) {
    await cancelNudges();
    return;
  }
  try {
    await cancelNudges();
    const now = new Date();
    const last = await AsyncStorage.getItem(LAST_PRACTICE_KEY);
    const dates = nudgeFireDates(now, practicedToday(last, now));
    const ids: string[] = [];
    for (const date of dates) {
      ids.push(
        await notifications.scheduleNotificationAsync({
          content: { title: NUDGE_TITLE, body: NUDGE_BODY },
          trigger: { type: notifications.SchedulableTriggerInputTypes.DATE, date },
        }),
      );
    }
    await AsyncStorage.setItem(NUDGE_IDS_KEY, JSON.stringify(ids));
  } catch {
    // 넛지는 부가 기능 — 실패해도 흐름을 막지 않는다.
  }
}

async function cancelNudges(): Promise<void> {
  if (!notifications) return;
  const raw = await AsyncStorage.getItem(NUDGE_IDS_KEY);
  if (!raw) return;
  await AsyncStorage.removeItem(NUDGE_IDS_KEY);
  let ids: string[] = [];
  try {
    ids = JSON.parse(raw) as string[];
  } catch {
    return; // 깨진 저장소 — 예약 id 를 잃었으니 그대로 둔다(울려도 한 사이클뿐).
  }
  for (const id of ids) {
    try {
      await notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // 이미 울렸거나 없는 예약 — 무시.
    }
  }
}
