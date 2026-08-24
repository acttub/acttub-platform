import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { logEvent } from '@/lib/analytics';
import {
  buildOneLinerPayload,
  type ExitReviewTrigger,
  type OneLinerPayload,
} from '@/lib/exit-review-policy';

/**
 * 한줄평 저장소 — 서버 API가 아니라 구글 시트다(SOMA-433, 사용자 결정).
 * 류지성 계정으로 배포한 Apps Script 웹 앱이 「acttub 리뷰 폼 응답」 시트의
 * '앱 한줄평' 탭에 행을 쌓는다. 응답은 ok / empty / ignored.
 */
export const EXIT_REVIEW_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbynlU4CAkxTaAqCr6JK_vh9icYADNx6mAboJXZE4x4nvrzQjvNrsvU0NA9Tq6mPYIN41w/exec';

const ASKED_KEY = 'acttub.exitReview.asked';

export async function hasAskedExitReview(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) === '1';
  } catch {
    // 저장소를 못 읽으면 물어본 적 없는 것으로 본다 — 한 번 더 뜨는 쪽이 안 뜨는 쪽보다 낫다.
    return false;
  }
}

export async function markExitReviewAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(ASKED_KEY, '1');
  } catch {
    // 못 적어도 흐름은 그대로 간다
  }
}

/** "0.0.5 (22)" 꼴. 어느 빌드에서 온 한줄평인지 시트에서 갈라 보려고. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '';
  const build = Constants.nativeBuildVersion ?? '';
  return build ? `${version} (${build})` : version;
}

export function oneLinerPayload(input: {
  text: string;
  screen: 'coach' | 'report';
  sessionId: string | null | undefined;
  userId: string | null | undefined;
}): OneLinerPayload | null {
  return buildOneLinerPayload({
    text: input.text,
    platform: Platform.OS,
    appVersion: appVersionLabel(),
    screen: input.screen,
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

/**
 * 시트로 보낸다. 실패해도 사용자를 붙잡지 않는다 — 나가려는 사람을 네트워크 오류로
 * 잡아 두면 안 된다. 성공 여부는 시트에서 본다.
 */
export async function submitOneLiner(payload: OneLinerPayload): Promise<boolean> {
  try {
    const response = await fetch(EXIT_REVIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function trackExitReviewOpened(trigger: ExitReviewTrigger): void {
  void logEvent('exit_review_opened', { trigger });
}

export function trackExitReviewSubmitted(trigger: ExitReviewTrigger, length: number): void {
  void logEvent('exit_review_submitted', { trigger, length });
}

export function trackExitReviewSkipped(trigger: ExitReviewTrigger): void {
  void logEvent('exit_review_skipped', { trigger });
}
