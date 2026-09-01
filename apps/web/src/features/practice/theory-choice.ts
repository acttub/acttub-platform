export const THEORY_CHOICES = [
  { id: "stanislavski", label: "스타니슬랍스키", description: "장면에서 무엇을 하려는지부터 봐요" },
  { id: "hagen", label: "우타 하겐", description: "인물과 나 사이의 거리부터 봐요" },
  { id: "meisner", label: "마이즈너", description: "상대에게서 오는 것부터 봐요" },
  { id: "chubbuck", label: "이바나 처벅", description: "목표를 행동으로 옮기는 것부터 봐요" },
  { id: "chekhov", label: "미하일 체홉", description: "몸과 이미지부터 봐요" },
  // "상관없음"은 은행 리소스가 아니다 — "이론은 아무거나 좋다"는 명시적 답을,
  // 아무것도 안 고른 무응답과 갈라 세려고 둔다.
  { id: "none", label: "상관없음", description: "코치가 어울리는 쪽을 골라요" },
] as const;

// id는 "none"을 빼면 SOMA-456의 은행 리소스 파일명과 같으며, 서버 계약이 서면 그대로 요청에 싣는다.
export type TheoryChoiceId = (typeof THEORY_CHOICES)[number]["id"];

export function toggleTheoryChoice(
  current: TheoryChoiceId | null,
  next: TheoryChoiceId,
): TheoryChoiceId | null {
  return current === next ? null : next;
}
