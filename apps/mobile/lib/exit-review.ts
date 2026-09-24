import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  buildOneLinerPayload,
  type ExitReviewTrigger,
  type OneLinerPayload,
} from '@/lib/exit-review-policy';
import { createFeedbackQueue } from '@/lib/practice/feedback';

/**
 * 의견 시트(설정·홈)의 저장소 — Apps Script 웹 앱이 시트에 행을 쌓는다.
 *
 * 이탈 설문(A7, coach·report)은 1.0.0에서 서버가 정본이고 시트는 서버가 복제한다
 * (practice.feedback). 앱은 그 경로에서 시트를 직접 부르지 않는다 — `practiceFeedback` 를 쓴다.
 */
export const EXIT_REVIEW_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbynlU4CAkxTaAqCr6JK_vh9icYADNx6mAboJXZE4x4nvrzQjvNrsvU0NA9Tq6mPYIN41w/exec';

/** "0.0.5 (22)" 꼴. 어느 빌드에서 온 한줄평인지 시트에서 갈라 보려고. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '';
  const build = Constants.nativeBuildVersion ?? '';
  return build ? `${version} (${build})` : version;
}

export function oneLinerPayload(input: {
  text: string;
  /** settings·home = 의견 시트. 노트 평가는 서버로 간다(lib/note-rating.ts). */
  screen: 'settings' | 'home';
  sessionId: string | null | undefined;
  userId: string | null | undefined;
  contactEmail?: string | null;
  contactPhone?: string | null;
}): OneLinerPayload | null {
  return buildOneLinerPayload({
    text: input.text,
    platform: Platform.OS,
    appVersion: appVersionLabel(),
    screen: input.screen,
    sessionId: input.sessionId,
    userId: input.userId,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
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

/**
 * 이탈 설문 접수(practice.feedback). 서버가 정본이고, 못 보내면 기기가 들고 있다가 다시 보낸다
 * — 같은 요청 id 라 행은 하나다.
 */
export const practiceFeedback = createFeedbackQueue({
  storage: AsyncStorage,
  submit: (body) => api.submitPracticeFeedback(body),
});

/** 게이트를 통과한 뒤 밀린 접수를 보낸다. */
export async function flushPracticeFeedback(): Promise<void> {
  await practiceFeedback.flush().catch(() => undefined);
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
