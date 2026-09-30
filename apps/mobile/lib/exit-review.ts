import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/lib/api';
import { createFeedbackQueue } from '@/lib/practice/feedback';

/**
 * 이탈 설문 접수 큐(practice.feedback). 설문 화면은 SOMA-494에서 걷었다(앱 평가 요청으로 대체) —
 * 이 큐는 그 전에 기기에 밀려 있던 접수를 마저 보내려고만 남긴다. 같은 요청 id 라 행은 하나다.
 */
export const practiceFeedback = createFeedbackQueue({
  storage: AsyncStorage,
  submit: (body) => api.submitPracticeFeedback(body),
});

/** 게이트를 통과한 뒤 밀린 접수를 보낸다. */
export async function flushPracticeFeedback(): Promise<void> {
  await practiceFeedback.flush().catch(() => undefined);
}
