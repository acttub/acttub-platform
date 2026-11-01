/**
 * 코치 대화(practice.coach)를 화면이 쓰는 모양으로 옮긴다. 순수 함수라 화면 없이 테스트한다.
 *
 * 응답과 대화 조회가 messages·revision·status 를 함께 준다.
 */
import type { Conversation, ConversationTurnResponse } from "@/lib/practice/api-types";

export interface ChatLine {
  role: "me" | "ai";
  text: string;
}

/** 대화 조회가 준 턴을 화면 줄로 옮긴다. turn_index 순서를 그대로 믿지 않고 여기서 세운다. */
export function conversationLines(conversation: Conversation): ChatLine[] {
  return [...conversation.messages]
    .sort((a, b) => a.turn_index - b.turn_index)
    .map((turn) => ({ role: turn.role === "actor" ? "me" : "ai", text: turn.text }));
}

/**
 * 배우가 보낸 답의 수. 계측의 "몇 번째 답"과 같은 값이다.
 * 영상만 올린 첫 시작에는 배우 메시지가 없으므로 actor 턴이 그대로 답의 수다(옛 계약처럼 첫
 * 항목을 장면 폼으로 빼지 않는다).
 */
export function actorTurnCount(conversation: Conversation): number {
  return conversation.messages.filter((turn) => turn.role === "actor").length;
}

/** 이 응답으로 대화가 닫혔는가. */
export function isConversationDone(turn: ConversationTurnResponse): boolean {
  return turn.conversation.status === "closed";
}

/**
 * 시작 응답만으로 화면을 세울 수 있는가. 새로 연 대화는 코치의 첫 말 하나가 전부라 조회가
 * 필요 없고, 이미 오간 대화를 재개한 것이면(revision 이 1 보다 크다) 지난 턴을 읽어야 한다.
 */
export function needsTurnHistory(turn: ConversationTurnResponse): boolean {
  return turn.conversation.revision > 1;
}
