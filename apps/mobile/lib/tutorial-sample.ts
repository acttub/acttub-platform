/**
 * 예시 영상으로 도는 튜토리얼의 가짜 회차·코치 (SOMA-494).
 *
 * <p>예시 경로는 서버를 한 번도 부르지 않는다. 튜토리얼 한 번마다 분석·코치 비용이 나가고,
 * 게스트 하루 분석 세 번을 깎고, 1~2분을 기다리게 하면 "한 번 둘러보기"가 아니다.
 * 대신 질문 둘과 연습 노트를 미리 써 두고, 실제 서버와 같은 응답 모양(회차 상세·대화·노트)으로
 * 돌려준다 — 그래야 코치·노트 화면의 규칙({@code lib/practice/coach}·{@code note})을 그대로 탄다.
 *
 * <p>예시 연습인지는 연습 id 로 가린다({@link isSamplePracticeId}). 전역 "튜토리얼 중" 표시로
 * 가리면, 튜토리얼 중간에 빠져나간 뒤 한 실제 연습까지 가짜 코치를 탈 수 있다.
 */

import { translate as t } from './i18n.ts';
import type {
  CoachConversation,
  CoachMessage,
  CoachReplyBody,
  CoachTurnResult,
  PracticeDetail,
  PracticeNote,
  PracticeScene,
} from './practice/types.ts';

export const SAMPLE_PRACTICE_ID = 'tutorial-sample-practice';
const SAMPLE_CONVERSATION_ID = 'tutorial-sample-conversation';
/** 질문 둘 + 마무리 한 번. 코치 화면이 "남은 응답"을 이걸로 센다. */
const SAMPLE_REPLY_LIMIT = 3;

/** 분석 대기 화면의 단계 문구를 넘기는 간격. 합쳐 몇 초면 끝난다. */
export const SAMPLE_ANALYZING_STEP_MS = [1200, 1400, 1200];

export function isSamplePracticeId(practiceId: string | null | undefined): boolean {
  return practiceId === SAMPLE_PRACTICE_ID;
}

export function sampleScene(): PracticeScene {
  return {
    situation: t('tutorial.sample.situation'),
    character: t('tutorial.sample.character'),
    goal: t('tutorial.sample.goal'),
  };
}

/** 회차 상세 — 분석 대기 화면의 "분석에 쓰는 내용"과 코치 화면의 대화 복원이 읽는다. */
export function sampleDetail(conversationId: string | null = null): PracticeDetail {
  return {
    id: SAMPLE_PRACTICE_ID,
    root_id: SAMPLE_PRACTICE_ID,
    ordinal: 1,
    stage: conversationId ? 'conversing' : 'analyzing',
    analysis_status: 'ready',
    job: null,
    video_id: null,
    scene: sampleScene(),
    blockage: { category: '그 외', detail: '그 외', note: null },
    created_at: new Date().toISOString(),
    playback_url: null,
    video_purged: false,
    conversation_id: conversationId,
    previous_conversations: [],
  };
}

function sampleNote(actorQuote: string | null): PracticeNote {
  return {
    id: 'tutorial-sample-note',
    conversation_id: SAMPLE_CONVERSATION_ID,
    format: 'v2',
    kind: 'action',
    title: t('tutorial.sample.noteTitle'),
    // 요약은 배우 말의 원문 발췌다 — 방금 적은 답을 그대로 인용한다. 없으면(바로 "그만") 관찰 한 줄.
    summary_quotes: actorQuote
      ? [{ quote: actorQuote, kind: 'actor', source_ref: 'tutorial-sample-answer' }]
      : [{ quote: t('tutorial.sample.noteSummary'), kind: 'observation', source_ref: 'tutorial-sample-observation' }],
    next_take: t('tutorial.sample.noteNext'),
    actor_words: actorQuote ? [actorQuote] : [],
    corrections: [],
    tags: [],
    fallback: false,
    report: null,
    source_revision: 1,
    created_at: new Date().toISOString(),
  };
}

/** 코치·노트 화면이 부르는 것 — 실제 {@code api} 와 같은 모양. */
export type LoopApi = {
  getPractice(practiceId: string): Promise<PracticeDetail>;
  getConversation(conversationId: string): Promise<CoachConversation>;
  getPracticeNote(practiceId: string): Promise<PracticeNote>;
  startConversation(practiceId: string, requestId: string): Promise<CoachTurnResult>;
  replyToCoach(body: CoachReplyBody): Promise<CoachTurnResult>;
};

/**
 * 질문 둘을 하고 닫히는 대화. "그만"을 보내면 그 자리에서 닫힌다.
 *
 * <p>대답을 읽지는 않는다 — 무엇을 적든 다음 질문으로 간다. 튜토리얼이 보여 줄 것은
 * "질문이 오고, 답하면 노트가 남는다"는 흐름이다. 다만 노트 요약은 배우의 첫 답을 인용한다.
 */
export function createSampleLoop(options: { delayMs?: number } = {}): LoopApi {
  const delayMs = options.delayMs ?? 900;
  const questions = [t('tutorial.sample.q1'), t('tutorial.sample.q2')];
  let conversation: CoachConversation | null = null;
  let note: PracticeNote | null = null;

  const wait = () =>
    delayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();

  const message = (role: CoachMessage['role'], text: string, turnIndex: number): CoachMessage => ({
    turn_index: turnIndex,
    role,
    text,
    created_at: new Date().toISOString(),
  });

  const snapshot = (c: CoachConversation): CoachConversation => ({ ...c, messages: [...c.messages] });

  const notFound = (code: string) => Object.assign(new Error(code), { code });

  return {
    async getPractice() {
      return sampleDetail(conversation?.id ?? null);
    },
    async getConversation(conversationId) {
      if (!conversation || conversation.id !== conversationId) throw notFound('conversation_not_found');
      return snapshot(conversation);
    },
    async getPracticeNote() {
      if (!note) throw notFound('note_not_found');
      return note;
    },
    async startConversation() {
      await wait();
      // 새 튜토리얼이면 처음부터다. 이미 열린 대화가 있으면 그대로 돌려준다(서버와 같다).
      if (!conversation || conversation.status === 'closed') {
        note = null;
        conversation = {
          id: SAMPLE_CONVERSATION_ID,
          practice_id: SAMPLE_PRACTICE_ID,
          status: 'open',
          close_reason: null,
          created_at: new Date().toISOString(),
          revision: 1,
          coach_reply_count: 1,
          reply_limit: SAMPLE_REPLY_LIMIT,
          messages: [message('coach', questions[0], 0)],
        };
        return { conversation: snapshot(conversation), message: questions[0], note: null };
      }
      return { conversation: snapshot(conversation), message: null, note };
    },
    async replyToCoach(body) {
      await wait();
      if (!conversation || conversation.status === 'closed') throw notFound('conversation_closed');
      const text = body.text.trim();
      const turn = conversation.messages.length;
      const messages = [...conversation.messages, message('actor', text, turn)];
      const answers = messages.filter((m) => m.role === 'actor' && m.text !== t('coach.endWord'));
      const ending = text === t('coach.endWord') || answers.length >= questions.length;
      const reply = ending ? t('tutorial.sample.closing') : questions[answers.length];
      messages.push(message('coach', reply, turn + 1));
      conversation = {
        ...conversation,
        messages,
        revision: conversation.revision + 1,
        coach_reply_count: conversation.coach_reply_count + 1,
        status: ending ? 'closed' : 'open',
        close_reason: ending ? (text === t('coach.endWord') ? 'user_ended' : 'exhausted') : null,
      };
      if (ending) note = sampleNote(answers[0]?.text ?? null);
      return { conversation: snapshot(conversation), message: reply, note: ending ? note : null };
    },
  };
}
