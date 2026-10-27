import type { CoachPurpose } from '../practice/types.ts';

/**
 * 리딩 녹음으로 바로 코칭(SOMA-791). 서버 `GET /v2/reading/sessions/{id}/voice-coaching` 응답과 카드 보임 규칙.
 * 시작은 새 경로 없이 `createPractice({ request_id, reading_session_id })` 다.
 */
export type ReadingVoiceCoaching = { available: boolean; practice_id: string | null };

export type VoiceCoachCard = { show: boolean; practiceId: string | null };

/** 응답(또는 오류)로 카드를 보일지 정한다. 404(스위치 꺼짐)·오류·available 거짓은 모두 숨긴다. */
export function voiceCoachCardState(result: ReadingVoiceCoaching | null | undefined): VoiceCoachCard {
  if (!result || result.available !== true) return { show: false, practiceId: null };
  return { show: true, practiceId: typeof result.practice_id === 'string' && result.practice_id ? result.practice_id : null };
}

/**
 * 코치가 마지막에 권한 다음 테이크 한 줄. 서버는 purpose.card.next.text 를 `"대본 줄"에서 시도할 것` 꼴로 준다 —
 * 첫 따옴표 쌍("..." 또는 “...”) 안의 글을 줄로 쓰고, 따옴표가 없으면 줄 없음(null)이다.
 */
export function readingNextLine(purpose: CoachPurpose | null | undefined): string | null {
  if (!purpose || purpose.purpose !== 'reading') return null;
  const text = purpose.card?.next?.text ?? '';
  const match = /"([^"]+)"|“([^”]+)”/.exec(text);
  const line = (match?.[1] ?? match?.[2] ?? '').trim();
  return line || null;
}
