/**
 * "외워서 말해보기"(reading.memorization). 말한 것을 원문과 대조한다 — 정규화 뒤 자모 편집거리 유사도 0.72 이상이면
 * 통과. 결과는 넘어가기·다시·원문 보기로만 보이고 수치·맞음·틀림은 내지 않는다. 같은 줄 2회 미달이면 안내 없이
 * 다음 줄로 간다. 인식 불가·무발화는 미달로 세지 않는다. quiz 회차의 대조 규칙도 이것이다.
 */
import { compare, MATCH_MAX_CHARS, normalizeForMatch } from "@/lib/reading/quiz/match";

export const MAX_RECITAL_MISS = 2;

export type RecitalOutcome =
  | { kind: "pass" }
  /** 미달, 같은 줄에 머문다 */
  | { kind: "retry"; misses: number }
  /** 2회 미달 — 안내 없이 다음 줄 */
  | { kind: "advance"; misses: number }
  /** 인식 불가·무발화·길이 상한 초과 — 세지 않는다 */
  | { kind: "nothing" };

export function judgeRecital(said: string, target: string, missesSoFar: number): RecitalOutcome {
  if (!normalizeForMatch(said) || said.length > MATCH_MAX_CHARS || target.length > MATCH_MAX_CHARS) return { kind: "nothing" };
  if (compare(said, target).pass) return { kind: "pass" };
  const misses = missesSoFar + 1;
  return misses >= MAX_RECITAL_MISS ? { kind: "advance", misses } : { kind: "retry", misses };
}
