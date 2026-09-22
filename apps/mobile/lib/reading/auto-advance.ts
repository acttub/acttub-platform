/**
 * 내 차례가 끝났는지 판정한다 (SOMA-549).
 *
 * <p>대본을 읽는 중에는 손이 화면에 없다. 상대 대사는 앱이 읽어 주는데 내 차례만 버튼을 눌러야
 * 하면 매 줄 흐름이 끊긴다. 그래서 말이 끝나면 스스로 넘어간다.
 *
 * <p><b>말을 자르는 것이 못 넘어가는 것보다 나쁘다.</b> 중간에 넘어가면 그 줄을 다시 해야 하고,
 * 안 넘어가면 버튼을 누르면 된다. 그래서 애매하면 기다린다 — 아무 말도 못 알아들었으면
 * 받아쓰기가 끝났다고 해도 넘어가지 않는다(조용한 방에서 그냥 끊긴 경우다).
 *
 * <p>판정만 여기 둔다. 듣기·타이머·화면은 부르는 쪽이 한다 — 그래야 마이크 없이 시험할 수 있다.
 */

/** 말을 멈춘 뒤 이만큼 조용하면 끝난 것으로 본다. 짧으면 말을 자르고, 길면 답답하다. */
export const SILENCE_MS = 1500;

export type AdvanceInput = {
  /** 지금까지 받아쓴 말. */
  heard: string;
  /** 마지막으로 무언가 들린 시각. 아직 아무것도 못 들었으면 null. */
  lastHeardAt: number | null;
  now: number;
  /** 받아쓰기가 스스로 끝났다고 알렸는가. */
  ended: boolean;
};

export type AdvanceReason = 'not_started' | 'speaking' | 'silence' | 'ended';

export type AdvanceDecision = { advance: boolean; reason: AdvanceReason };

export function advanceDecision(input: AdvanceInput): AdvanceDecision {
  const started = input.heard.trim().length > 0 && input.lastHeardAt !== null;
  if (!started) return { advance: false, reason: 'not_started' };
  if (input.ended) return { advance: true, reason: 'ended' };
  const quietFor = input.now - (input.lastHeardAt as number);
  return quietFor >= SILENCE_MS
    ? { advance: true, reason: 'silence' }
    : { advance: false, reason: 'speaking' };
}

/**
 * 이어서 들리는 말을 합친다.
 *
 * <p>받아쓰기는 중간 결과를 주는데, 더 들을수록 길어지다가 이따금 짧게 되돌아온다. 그대로 쓰면
 * 화면의 글이 줄었다 늘었다 한다. 길어지는 쪽만 남겨 이미 들은 말을 잃지 않는다.
 */
export function mergeTranscript(current: string, incoming: string): string {
  const next = (incoming ?? '').trim();
  const now = (current ?? '').trim();
  if (!next) return now;
  return next.length >= now.length ? next : now;
}
