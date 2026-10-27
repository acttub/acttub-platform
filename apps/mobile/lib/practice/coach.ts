import { errorCode, errorStatus, isOfflineError } from '../api-request.ts';
import { translate } from '../i18n.ts';
import type { CoachConversation, CoachMessage, CoachReplyBody, CoachStreamCallbacks, CoachTurnResult, PracticeDetail, PracticeNote } from './types.ts';
import { COACH_ANSWER_MAX } from './types.ts';
import { readOptionalPracticeNote } from './note.ts';
import { readableText } from './readable-text.ts';

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
  startConversation: (id: string, requestId: string, stream?: CoachStreamCallbacks) => Promise<CoachTurnResult>;
};

/**
 * 화면 재진입은 서버의 대화 id로 복원한다. 닫힌 대화에 start를 보내지 않는다.
 * 대화가 열려 있는데 코치 말이 아직 없으면(서버가 첫 질문을 미리 쓰는 중에 대화가 먼저 생긴 경우, SOMA-780) 읽기만 하고
 * 끝내지 않고 시작 요청을 한 번 보낸다. 서버는 같은 회차의 시작을 하나로 모아, 쓰는 중이면 끝나길 기다렸다가 저장된
 * 첫 질문을 돌려주고 없으면 새로 쓴다. 재조회 반복이 아니라 요청 한 번이라 무한히 되풀이되지 않는다.
 */
export async function loadCoachSession(api: CoachSessionApi, practiceId: string, requestId: string, conversationId?: string | null, stream?: CoachStreamCallbacks): Promise<CoachTurnResult> {
  const id = conversationId ?? (await api.getPractice(practiceId)).conversation_id;
  if (!id) return api.startConversation(practiceId, requestId, stream);
  const conversation = await api.getConversation(id);
  if (!isClosed(conversation) && !conversation.messages.some((m) => m.role === 'coach')) {
    return api.startConversation(practiceId, requestId, stream);
  }
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
  return Boolean(text && !input.waiting && !input.closed && input.conversationId) && text.length <= COACH_ANSWER_MAX && readableText(text);
}

/** 서버가 422로 막기 전에 화면이 먼저 막는다. */
export function answerTooLong(text: string): boolean {
  return text.trim().length > COACH_ANSWER_MAX;
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

/**
 * 정리 화면의 「대화 이어하기」(SOMA-782, pen ⓐ4)를 보일 수 있는가. 닫힌 대화이고 예시 회차가 아닐 때만이다.
 * 코치 응답 상한에 가까우면 서버가 409 conversation_limit_reached 로 막고 화면은 안내만 한다.
 */
export function canContinueConversation(conversation: Pick<CoachConversation, 'status' | 'id'> | null, sample: boolean): boolean {
  return Boolean(conversation && isClosed(conversation) && !sample);
}

export function isClosed(conversation: Pick<CoachConversation, 'status'> | null): boolean {
  return conversation?.status === 'closed';
}

/** 화면에 그리는 순서는 turn_index 다. 서버가 순서를 정한다. */
export function orderedMessages(conversation: Pick<CoachConversation, 'messages'>): CoachMessage[] {
  return [...conversation.messages].sort((a, b) => a.turn_index - b.turn_index);
}

export type HelpButton = 'yes' | 'no' | 'unsure';

/**
 * 빠른 답 버튼(맞아요·아니요)이 준비하는 입력. 버튼만 눌러서는 아무것도 전송되지 않고 응답 횟수도 쓰지 않는다 —
 * 배우가 덧붙여 쓰고 보낸다(SOMA-656). 코치에게 묻고 싶은 건 입력칸에 그대로 쓴다.
 */
export function helpButtonDraft(button: HelpButton): string {
  return translate(button === 'yes' ? 'coach.yesMessage' : button === 'no' ? 'coach.noMessage' : 'coach.unsureMessage');
}

/**
 * 질문 대화의 답 버튼(pen 「질문 대화」 예시 답 칩). 서버가 지금 질문에 맞춰 준 예시 답 1~2개 뒤에 「잘 모르겠어요」를 둔다.
 * 고정 「맞아요·아니요」는 코치가 "A예요, B예요?"로 물어도 같아서 뺐다. 목적별 코칭은 purpose.choices 를 그대로 쓰므로 여기서는 비운다.
 * 질문을 기다리는 동안·닫힌 대화·마지막 말이 코치 질문이 아닐 때는 버튼이 없다.
 */
export function answerChoices(conversation: CoachConversation | null, opts: { busy: boolean }): string[] {
  if (!conversation || opts.busy || isClosed(conversation) || conversation.purpose) return [];
  const last = orderedMessages(conversation).at(-1);
  if (last?.role !== 'coach') return [];
  const examples = (conversation.answer_examples ?? []).map((label) => label.trim()).filter(Boolean).slice(0, 2);
  const unsure = translate('coach.quickUnsure');
  return [...examples.filter((label) => label !== unsure), unsure];
}

export type CoachFailure =
  /** 다른 요청이 먼저 반영됐다. 입력을 보존하고 최신 대화를 다시 읽는다. */
  | { kind: 'conflict' }
  /** 대화가 닫혔다. 다시 코칭하려면 새 회차다. */
  | { kind: 'closed' }
  /** 분석이 아직 쓸 수 없다. */
  | { kind: 'not_ready' }
  /** 응답 상한에 가까워 더 이어 갈 수 없다(대화 이어하기). */
  | { kind: 'limit_reached' }
  /** 옛 갈래·연기가 아니어서 끊긴 대화는 이어 갈 수 없다(대화 이어하기). */
  | { kind: 'not_resumable' }
  | { kind: 'fingerprint_mismatch' }
  | { kind: 'too_long' }
  /** 허용 범위 밖 글자(결합 기호를 쌓은 글 등)가 섞였다. */
  | { kind: 'unreadable' }
  | { kind: 'offline' }
  | { kind: 'other' };

export function coachFailure(error: unknown): CoachFailure {
  const code = errorCode(error);
  const status = errorStatus(error);
  if (code === 'conversation_conflict') return { kind: 'conflict' };
  if (code === 'conversation_closed') return { kind: 'closed' };
  if (code === 'analysis_not_ready') return { kind: 'not_ready' };
  if (code === 'conversation_limit_reached') return { kind: 'limit_reached' };
  if (code === 'conversation_not_resumable') return { kind: 'not_resumable' };
  if (code === 'request_fingerprint_mismatch') return { kind: 'fingerprint_mismatch' };
  if (code === 'unreadable_text') return { kind: 'unreadable' };
  if (status === 422) return { kind: 'too_long' };
  if (isOfflineError(error)) return { kind: 'offline' };
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
    case 'limit_reached':
      return translate('coach.continueLimit');
    case 'not_resumable':
      return translate('coach.continueNotResumable');
    case 'too_long':
      return translate('coach.answerTooLong');
    case 'unreadable':
      return translate('coach.answerUnreadable');
    case 'fingerprint_mismatch':
      return translate('errors.requestChanged');
    case 'offline':
      return translate('coach.offline');
    default:
      return translate('coach.sendFail');
  }
}
