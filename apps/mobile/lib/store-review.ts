import * as StoreReview from 'expo-store-review';
import { Linking, Platform } from 'react-native';

import { storeReviewUrl } from '@/lib/app-rating';

/** 스토어의 리뷰 쓰기 화면을 연다 — 설정의 "앱 평가하기"처럼 사용자가 직접 누른 자리. */
export async function openStoreReviewPage(): Promise<void> {
  await Linking.openURL(storeReviewUrl(Platform.OS)).catch(() => undefined);
}

/**
 * 인앱 평점 창(앱을 떠나지 않는 별점)을 먼저 부르고, OS 가 그 창을 줄 수 없으면(사이드로드·에뮬·한도)
 * 스토어의 리뷰 쓰기 화면으로 보낸다.
 */
export async function openStoreReview(): Promise<void> {
  try {
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
      return;
    }
  } catch {
    // 인앱 창이 실패하면 스토어로 넘어간다
  }
  await openStoreReviewPage();
}
