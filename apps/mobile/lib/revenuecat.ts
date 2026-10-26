/**
 * RevenueCat SDK(react-native-purchases) 연결(SOMA-818 2단계). 구매자는 우리 user id 다 — 처음 쓸 때 그 id 로 configure 하고,
 * 다른 사람으로 바뀌면 logIn, 로그아웃하면 logOut 한다. 공개 SDK 키는 빌드 환경변수
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY·EXPO_PUBLIC_REVENUECAT_ANDROID_KEY 로만 받고, 비어 있으면 스토어 구매를 열지 않는다.
 * 서버 플래그(app_enabled)가 꺼져 있으면 아무도 이 파일을 부르지 않는다.
 */
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

import { revenueCatKey, type StorePlatform } from '@/lib/store-billing';

export function storePlatform(): StorePlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

/** 이 빌드에 이 플랫폼의 RevenueCat 키가 있는가. */
export function revenueCatAvailable(): boolean {
  return currentKey() !== null;
}

function currentKey(): string | null {
  // Expo 는 process.env.EXPO_PUBLIC_* 를 빌드 때 그대로 박는다 — 정적인 이름으로 읽어야 한다.
  return revenueCatKey(storePlatform(), {
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  });
}

let pending: Promise<void> = Promise.resolve();

/** 순서대로 한 번에 하나씩 — configure·logIn·logOut 이 겹치지 않게. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = pending.then(task, task);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** RevenueCat 을 이 사람(우리 user id)으로 맞춘다. 키가 없으면 store_unavailable 로 던진다. */
export function identify(userId: string): Promise<void> {
  return serial(async () => {
    const apiKey = currentKey();
    if (!apiKey) throw Object.assign(new Error('store_unavailable'), { code: 'store_unavailable' });
    if (!(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey, appUserID: userId });
      return;
    }
    if ((await Purchases.getAppUserID()) !== userId) await Purchases.logIn(userId);
  });
}

/** 로그아웃 — 설정된 적이 있고 익명이 아닐 때만 RevenueCat 에서도 빠진다. 실패해도 앱 로그아웃은 막지 않는다. */
export function forget(): Promise<void> {
  return serial(async () => {
    try {
      if (!(await Purchases.isConfigured())) return;
      if (await Purchases.isAnonymous()) return;
      await Purchases.logOut();
    } catch {
      // 다음 identify 가 logIn 으로 바로잡는다.
    }
  });
}

export { Purchases };
