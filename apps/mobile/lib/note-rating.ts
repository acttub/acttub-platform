import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/lib/api';
import { createNoteRatingQueue } from '@/lib/practice/note-rating';

/**
 * 노트 평가 전송(practice.note). 서버가 정본이고, 못 보내면 기기가 같은 요청 id 로 들고 있다가 다시 보낸다.
 * 키가 `acttub.` 로 시작해 계정을 바꾸거나 탈퇴하면 로컬 정리가 함께 지운다.
 */
export const noteRatings = createNoteRatingQueue({
  storage: AsyncStorage,
  submit: (practiceId, body) => api.putNoteRating(practiceId, body),
});

/** 게이트를 통과한 뒤 밀린 평가를 보낸다. */
export async function flushNoteRatings(): Promise<void> {
  await noteRatings.flush().catch(() => undefined);
}
