import {
  createNoteRatingQueue,
  noteRatingCommentText,
  type NoteRatingStorage,
} from '../practice/note-rating.ts';

/**
 * 리딩 평가(reading.session, SOMA-661) — 리딩이 끝난 화면의 "이번 리딩 어땠나요?". 노트 평가(practice.note)와
 * 같은 꼴이다: 누르는 순간 서버에 리딩 회차 단위로 남기고(다시 누르면 덮어쓴다), 한 줄은 선택이고, 못 보낸
 * 요청은 같은 요청 id 로 들고 있다가 다시 보낸다. 대기열 자리만 노트 평가와 따로 둔다.
 */
export const READING_RATING_PENDING_KEY = 'acttub.readingRating.pending';
export const READING_RATING_COMMENT_MAX = 100;

export type ReadingRatingValue = 'good' | 'bad';

export type ReadingRatingBody = { request_id: string; rating: ReadingRatingValue; comment?: string };

/** PUT /v2/reading/sessions/{id}/rating 의 답이자 회차 조회의 my_rating. */
export type ReadingRating = { rating: ReadingRatingValue; comment: string | null; updated_at: string };

export function buildReadingRatingBody(input: {
  requestId: string;
  rating: ReadingRatingValue;
  /** 빼거나 비우면 서버가 한 줄을 비운다. */
  comment?: string | null;
}): ReadingRatingBody {
  const body: ReadingRatingBody = { request_id: input.requestId, rating: input.rating };
  const comment = noteRatingCommentText(input.comment);
  if (comment !== null) body.comment = comment;
  return body;
}

export function createReadingRatingQueue(dependencies: {
  storage: NoteRatingStorage;
  submit: (sessionId: string, body: ReadingRatingBody) => Promise<unknown>;
}) {
  return createNoteRatingQueue<ReadingRatingBody>({ ...dependencies, pendingKey: READING_RATING_PENDING_KEY });
}
