import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/lib/api';
import { createReadingRatingQueue } from '@/lib/reading/session-rating';

/**
 * 리딩 평가 전송(reading.session, SOMA-661). 서버가 정본이고, 못 보내면 기기가 같은 요청 id 로 들고 있다가 다시
 * 보낸다. 키가 `acttub.` 로 시작해 계정을 바꾸거나 탈퇴하면 로컬 정리가 함께 지운다.
 */
export const readingRatings = createReadingRatingQueue({
  storage: AsyncStorage,
  submit: (sessionId, body) => api.putReadingSessionRating(sessionId, body),
});

/** 게이트를 통과한 뒤 밀린 평가를 보낸다. */
export async function flushReadingRatings(): Promise<void> {
  await readingRatings.flush().catch(() => undefined);
}
