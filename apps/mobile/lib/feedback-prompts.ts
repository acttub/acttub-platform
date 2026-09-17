import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

import { logEvent } from '@/lib/analytics';

/**
 * 홈 의견 넛지·스토어 평점 요청 — 둘 다 "연습 N회 뒤 한 번".
 * 넛지는 3회(우리 시트로 한 줄), 스토어 평점은 5회(OS 팝업). 둘이 같은 날 겹치지 않게 간격을 둔다.
 */
export const FEEDBACK_NUDGE_AFTER = 3;
export const STORE_REVIEW_AFTER = 5;

const NUDGE_KEY = 'acttub.feedbackNudge.done';
const STORE_KEY = 'acttub.storeReview.requested';

async function flag(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch {
    return true; // 못 읽으면 이미 한 것으로 — 귀찮게 두 번 뜨는 쪽보다 낫다
  }
}
async function setFlag(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // 못 적어도 흐름은 그대로
  }
}

/** 순수 판정 — 테스트용. */
export function shouldShowFeedbackNudge(practiceCount: number, done: boolean): boolean {
  return !done && practiceCount >= FEEDBACK_NUDGE_AFTER;
}

export async function feedbackNudgeVisible(practiceCount: number): Promise<boolean> {
  return shouldShowFeedbackNudge(practiceCount, await flag(NUDGE_KEY));
}

/** 닫든 남기든 한 번 보이면 끝. */
export async function dismissFeedbackNudge(): Promise<void> {
  await setFlag(NUDGE_KEY);
}

/**
 * 스토어 평점 팝업 — 조건이 되면 한 번만 부른다. 스토어에서 설치한 앱에서만 실제로 뜨고
 * (사이드로드 APK·에뮬은 조용히 무시), OS가 노출 빈도를 따로 제한한다.
 */
export async function maybeRequestStoreReview(practiceCount: number): Promise<void> {
  if (practiceCount < STORE_REVIEW_AFTER) return;
  if (await flag(STORE_KEY)) return;
  await setFlag(STORE_KEY);
  try {
    if (!(await StoreReview.hasAction())) return;
    logEvent('store_review_request', { count: practiceCount });
    await StoreReview.requestReview();
  } catch {
    // 평점 요청 실패는 사용자에게 알릴 일이 아니다
  }
}
