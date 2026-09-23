import { translate } from '../i18n.ts';
import type { CoachConversation, CoachMessage, CoachReplyBody, CoachTurnResult, PracticeDetail, PracticeNote } from './types.ts';
import { COACH_ANSWER_MAX } from './types.ts';
import { readOptionalPracticeNote } from './note.ts';

/**
 * 코치 대화 화면의 규칙(practice.coach). 코치의 행동 규칙(CONTRACT §7·§8, ADR-027)은 서버 것이고,
 * 여기는 앱이 지켜야 하는 것만 본다 — 보낼 수 있는지, 답이 300자를 넘는지, 응답이 몇 번 남았는지,
 * 오류를 어떻게 가르는지. 도움 버튼은 입력만 채우고 배우가 보내야 전송된다.
 */
export const COACH_END_WORD = '그만';

type CoachSessionApi = {
  getPractice: (id: string) => Promise<PracticeDetail>;
  getConversation: (id: string) => Promise<CoachConversation>;
  getPracticeNote: (id: string) => Promise<PracticeNote>;
  startConversation: (id: string, requestId: string) => Promise<CoachTurnResult>;
};

/** 화면 재진입은 서버의 대화 id로 복원한다. 닫힌 대화에 start를 보내지 않는다. */
export async function loadCoachSession(api: CoachSessionApi, practiceId: string, requestId: string, conversationId?: string | null): Promise<CoachTurnResult> {
  const id = conversationId ?? (await api.getPractice(practiceId)).conversation_id;
  if (!id) return api.startConversation(practiceId, requestId);
  const conversation = await api.getConversation(id);
  let note: PracticeNote | null = null;
  if (isClosed(conversation)) {
    note = await readOptionalPracticeNote(api.getPracticeNote, practiceId);
  }
  return { conversation, message: null, note };
}

export type CoachInput = {
  text: string;
  waiting: boolean;
  closed: boolean;
  conversationId: string | null;
};

export function canSendAnswer(input: CoachInput): boolean {
  const text = input.text.trim();
  return Boolean(text && !input.waiting && !input.closed && input.conversationId) && text.length <= COACH_ANSWER_MAX;
}

/** 서버가 422로 막기 전에 화면이 먼저 막는다. */
export function answerTooLong(text: string): boolean {
  return text.trim().length > COACH_ANSWER_MAX;
}

/** "그만"이라고 쓰면 언제든 마친다. 버튼으로 마치는 것도 같은 말을 보낸다. */
export function isEndWord(text: string): boolean {
  return text.trim() === COACH_END_WORD;
}

export function buildReplyBody(input: {
  conversation: Pick<CoachConversation, 'id' | 'revision'>;
  requestId: string;
  text: string;
}): CoachReplyBody {
  return {
    conversation_id: input.conversation.id,
    request_id: input.requestId,
    text: input.text.trim(),
    revision: input.conversation.revision,
  };
}

/** 코치 응답이 몇 번 남았는지. 상한은 시작 응답을 포함해 기존 갈래 8, 신형 10이다. */
export function remainingCoachReplies(conversation: Pick<CoachConversation, 'coach_reply_count' | 'reply_limit'>): number {
  return Math.max(0, conversation.reply_limit - conversation.coach_reply_count);
}

/** 다음 답이 마지막 코치 응답(마무리)인지 — 화면이 미리 알린다. */
export function nextReplyWraps(conversation: Pick<CoachConversation, 'coach_reply_count' | 'reply_limit'>): boolean {
  return remainingCoachReplies(conversation) <= 1;
}

export function isClosed(conversation: Pick<CoachConversation, 'status'> | null): boolean {
  return conversation?.status === 'closed';
}

/** 화면에 그리는 순서는 turn_index 다. 서버가 순서를 정한다. */
export function orderedMessages(conversation: Pick<CoachConversation, 'messages'>): CoachMessage[] {
  return [...conversation.messages].sort((a, b) => a.turn_index - b.turn_index);
}

export type HelpButton = 'explain' | 'ask_back' | 'later';

/**
 * 도움 버튼이 준비하는 입력. 버튼만 눌러서는 아무것도 전송되지 않고 응답 횟수도 쓰지 않는다
 * ("제가 되물을게요"는 배우가 직접 쓰도록 빈 칸을 준다).
 */
export function helpButtonDraft(button: HelpButton): string {
  if (button === 'explain') return translate('coach.explainMessage');
  if (button === 'later') return translate('coach.laterMessage');
  return '';
}

export type CoachFailure =
  /** 다른 요청이 먼저 반영됐다. 입력을 보존하고 최신 대화를 다시 읽는다. */
  | { kind: 'conflict' }
  /** 대화가 닫혔다. 다시 코칭하려면 새 회차다. */
  | { kind: 'closed' }
  /** 분석이 아직 쓸 수 없다. */
  | { kind: 'not_ready' }
  | { kind: 'fingerprint_mismatch' }
  | { kind: 'too_long' }
  | { kind: 'offline' }
  | { kind: 'other' };

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function statusOf(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function coachFailure(error: unknown): CoachFailure {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'conversation_conflict') return { kind: 'conflict' };
  if (code === 'conversation_closed') return { kind: 'closed' };
  if (code === 'analysis_not_ready') return { kind: 'not_ready' };
  if (code === 'request_fingerprint_mismatch') return { kind: 'fingerprint_mismatch' };
  if (status === 422) return { kind: 'too_long' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || status === null || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function coachFailureMessage(failure: CoachFailure): string {
  switch (failure.kind) {
    case 'conflict':
      return translate('coach.conflict');
    case 'closed':
      return translate('coach.closed');
    case 'not_ready':
      return translate('coach.notReady');
    case 'too_long':
      return translate('coach.answerTooLong');
    case 'fingerprint_mismatch':
      return translate('errors.requestChanged');
    case 'offline':
      return translate('coach.offline');
    default:
      return translate('coach.sendFail');
  }
}
