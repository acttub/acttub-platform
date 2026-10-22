import { formatKoreanDate } from '../format.ts';
import { translate } from '../i18n.ts';

/**
 * 배우 일지(practice.journal, SOMA-720) — 고정 질문 4개와 요약형 완성 일지의 규칙.
 *
 * pen ⑧ 「배우 일지 질문 1~4 / 4」(XdSzJ·soHlg·dpZuU·ZdSSK), 「배우 일지(노트) · 완성 (요약형)」(On3qF), 「배우 일지 · 편집」(s8Reko).
 * 10/19 채택안(요약형): 위 상자에 오늘의 후기·느낌 태그·아직 모르는 것 N개, 그 아래 다음에 해 볼 것, 나머지는 한 줄 미리보기 목록.
 * 빈 칸은 목록에서 빠진다. 배우의 답은 고치지 않고 그대로 보인다(「없어요」·「아직 안 정했어요」는 숨긴다).
 */

export type JournalFeeling = { choice: string | null; text: string | null };
export type JournalUnknown = { none: boolean | null; text: string | null };
export type JournalNext = { undecided: boolean | null; text: string | null };
export type JournalAnswers = {
  feeling: JournalFeeling | null;
  unknown: JournalUnknown | null;
  next: JournalNext | null;
  review: string | null;
};
export type JournalPracticeLine = { text: string; basis: string };
export type JournalCharacterLine = { aspect: 'wants' | 'partner' | 'situation' | string; text: string };
export type JournalFeedbackLine = { text: string; giver: string; at: number | null };
export type JournalDraftStatus = 'pending' | 'ready' | 'failed' | 'skipped';

/** GET·POST·PUT /v2/practices/{id}/journal 의 응답(PracticeJournal). */
export type PracticeJournal = {
  id: string;
  practice_id: string;
  conversation_id: string | null;
  answers: JournalAnswers;
  draft_status: JournalDraftStatus;
  practice: JournalPracticeLine[];
  character: JournalCharacterLine[];
  feedback: JournalFeedbackLine[];
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
  purpose: 'evaluate' | 'stuck' | 'character' | 'concern' | null;
  role_name: string | null;
};

export type JournalUpdateBody = {
  answers: JournalAnswers;
  practice: JournalPracticeLine[];
  character: JournalCharacterLine[];
  feedback: JournalFeedbackLine[];
};

// ---- 질문 ----

export type QuestionId = 'feeling' | 'unknown' | 'next' | 'review';

/** 질문의 선택지 칩. `skip` 칩(없어요·아직 안 정했어요)은 고르면 그 칸을 일지에서 숨긴다. */
export type QuestionChoice = { key: string; label: string; skip?: boolean };

export type JournalQuestion = { id: QuestionId; title: string; choices: QuestionChoice[]; placeholder: string };

/** 질문 문구와 순서는 항상 같다(10/19 questions.json). 대화 내용으로 바꾸지 않는다. */
export function journalQuestions(): JournalQuestion[] {
  return [
    {
      id: 'feeling',
      title: translate('journal.q1'),
      choices: (['easy', 'nervous', 'awkward', 'unsure'] as const).map((key) => ({ key, label: translate(`journal.feeling.${key}`) })),
      placeholder: translate('journal.q1Ph'),
    },
    { id: 'unknown', title: translate('journal.q2'), choices: [{ key: 'none', label: translate('journal.none'), skip: true }], placeholder: translate('journal.q2Ph') },
    { id: 'next', title: translate('journal.q3'), choices: [{ key: 'undecided', label: translate('journal.undecided'), skip: true }], placeholder: translate('journal.q3Ph') },
    { id: 'review', title: translate('journal.q4'), choices: [], placeholder: translate('journal.q4Ph') },
  ];
}

/** 한 질문에 고른 칩과 직접 쓴 글. 건너뛰면 둘 다 비운다. */
export type QuestionDraft = { choice: string | null; text: string };
export const EMPTY_DRAFT: QuestionDraft = { choice: null, text: '' };

/** 「다음」(4번째는 「일지 만들기」)을 누를 수 있는가 — 칩을 골랐거나 글을 썼다. 아무것도 없으면 「건너뛰기」만 된다. */
export function canAnswer(draft: QuestionDraft): boolean {
  return !!draft.choice || draft.text.trim().length > 0;
}

/** 네 질문의 답을 서버 모양으로. 글은 앞뒤 공백만 걷고 고치지 않는다. 건너뛴 질문은 null. */
export function buildAnswers(drafts: Record<QuestionId, QuestionDraft>): JournalAnswers {
  const text = (value: string) => value.trim() || null;
  const feeling = drafts.feeling;
  const unknown = drafts.unknown;
  const next = drafts.next;
  return {
    feeling: canAnswer(feeling) ? { choice: feeling.choice, text: text(feeling.text) } : null,
    unknown: canAnswer(unknown) ? { none: unknown.choice === 'none', text: text(unknown.text) } : null,
    next: canAnswer(next) ? { undecided: next.choice === 'undecided', text: text(next.text) } : null,
    review: text(drafts.review.text),
  };
}

// ---- 완성 일지(요약형) ----

export type JournalRowKey = 'feedback' | 'practice' | 'feeling' | 'character' | 'unknown';

/** 목록 한 줄. `lines` 는 펼쳤을 때·편집할 때의 줄들이고, `preview` 는 접힌 한 줄 미리보기다. */
export type JournalRow = { key: JournalRowKey; label: string; preview: string; lines: JournalRowLine[] };
export type JournalRowLine = { id: string; text: string; prefix?: string; at?: number | null };

export type JournalSummary = {
  review: string | null;
  feelingTag: string | null;
  unknownCount: number;
  next: string | null;
  rows: JournalRow[];
};

export const PREVIEW_CHARS = 14;

/** 접힌 줄 미리보기 — 앞 글자 몇 개 뒤에 말줄임(pen 「▶ 0:31 · 「잘 지내」…」). */
export function preview(text: string, max: number = PREVIEW_CHARS): string {
  const chars = [...text.trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** 영상 시간 「▶ 0:31」. */
export function timeLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `▶ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function feelingText(feeling: JournalFeeling | null): string | null {
  if (!feeling) return null;
  const parts = [feeling.choice?.trim(), feeling.text?.trim()].filter((part): part is string => !!part);
  return parts.length ? parts.join(' · ') : null;
}

export function unknownText(unknown: JournalUnknown | null): string | null {
  return unknown?.text?.trim() || null;
}

/** 「다음에 해 볼 것」 — 질문 3에 직접 쓴 글. 「아직 안 정했어요」만 골랐거나 건너뛰었으면 null. 홈 숙제도 이 값을 먼저 쓴다. */
export function journalNext(journal: Pick<PracticeJournal, 'answers'> | null | undefined): string | null {
  return journal?.answers.next?.text?.trim() || null;
}

/**
 * 요약형 완성 일지의 모양. 목록 순서는 pen 그대로(액티가 본 장면 → 오늘 한 연습 → 해 보니 → 장면과 인물 → 아직 모르는 것)이고,
 * 인물 이해하기는 「인물 카드가 맨 위」(pen ⓒ3 메모)라 장면과 인물을 맨 위로 올린다. 빈 칸은 뺀다.
 */
export function journalSummary(journal: PracticeJournal): JournalSummary {
  const { answers } = journal;
  const rows: JournalRow[] = [];
  const feedback = journal.feedback.filter((line) => line.text.trim());
  if (feedback.length) {
    const lines = feedback.map((line, index) => ({ id: `feedback-${index}`, text: line.text, at: line.at, prefix: line.at != null ? timeLabel(line.at) : undefined }));
    const first = lines[0];
    rows.push({ key: 'feedback', label: translate('journal.row.feedback'), preview: preview(first.prefix ? `${first.prefix} · ${first.text}` : first.text, 20), lines });
  }
  const practice = journal.practice.filter((line) => line.text.trim());
  if (practice.length) {
    rows.push({ key: 'practice', label: translate('journal.row.practice'), preview: preview(practice[0].text), lines: practice.map((line, index) => ({ id: `practice-${index}`, text: line.text })) });
  }
  const feeling = feelingText(answers.feeling);
  if (feeling) rows.push({ key: 'feeling', label: translate('journal.row.feeling'), preview: preview(feeling, 18), lines: [{ id: 'feeling', text: feeling }] });
  const character = journal.character.filter((line) => line.text.trim());
  if (character.length) {
    const lines = character.map((line, index) => ({ id: `character-${index}`, text: line.text, prefix: aspectLabel(line.aspect) }));
    const row: JournalRow = { key: 'character', label: translate('journal.row.character'), preview: preview(character[0].text), lines };
    if (journal.purpose === 'character') rows.unshift(row);
    else rows.push(row);
  }
  const unknown = unknownText(answers.unknown);
  if (unknown) rows.push({ key: 'unknown', label: translate('journal.row.unknown'), preview: preview(unknown), lines: [{ id: 'unknown', text: unknown }] });
  return {
    review: answers.review?.trim() || null,
    feelingTag: answers.feeling?.choice?.trim() || null,
    unknownCount: unknown ? 1 : 0,
    next: journalNext(journal),
    rows,
  };
}

function aspectLabel(aspect: string): string | undefined {
  return aspect === 'wants' || aspect === 'partner' || aspect === 'situation' ? translate(`journal.aspect.${aspect}`) : undefined;
}

const PURPOSES = ['evaluate', 'stuck', 'character', 'concern'] as const;

/** 머리 줄 「10월 23일 · 서연 역 · 평가 받기」. 모르는 칸은 뺀다. */
export function journalMeta(journal: Pick<PracticeJournal, 'created_at' | 'role_name' | 'purpose'>): string {
  const parts = [formatKoreanDate(journal.created_at, { month: 'long', day: 'numeric' })];
  if (journal.role_name?.trim()) parts.push(translate('journal.role', { name: journal.role_name.trim() }));
  if (journal.purpose && (PURPOSES as readonly string[]).includes(journal.purpose)) parts.push(translate(`journal.purpose.${journal.purpose}`));
  return parts.filter(Boolean).join(' · ');
}

/** 제목 — AI 가 본 장면 이름(회차 제목). 없으면 목적·날짜(pen 「배우 일지(노트)」 메모, 24개 중 10·11번). */
export function journalTitle(journal: Pick<PracticeJournal, 'title' | 'created_at' | 'purpose'>): string {
  const title = journal.title?.trim();
  if (title) return title;
  const date = formatKoreanDate(journal.created_at, { month: 'long', day: 'numeric' });
  const purpose = journal.purpose && (PURPOSES as readonly string[]).includes(journal.purpose) ? translate(`journal.purpose.${journal.purpose}`) : null;
  return [purpose ?? translate('journal.title'), date].filter(Boolean).join(' · ');
}

// ---- 편집 ----

/** 편집 화면의 고칠 수 있는 값들. 배우의 답(후기·다음·해 보니 글·모르는 것)과 AI 칸의 줄들. */
export type JournalEdit = {
  review: string;
  next: string;
  feelingText: string;
  unknown: string;
  practice: string[];
  character: string[];
  feedback: string[];
};

export function editOf(journal: PracticeJournal): JournalEdit {
  return {
    review: journal.answers.review ?? '',
    next: journal.answers.next?.text ?? '',
    feelingText: journal.answers.feeling?.text ?? '',
    unknown: journal.answers.unknown?.text ?? '',
    practice: journal.practice.map((line) => line.text),
    character: journal.character.map((line) => line.text),
    feedback: journal.feedback.map((line) => line.text),
  };
}

/**
 * 고친 값을 PUT 본문으로. 고르지 않은 칸의 선택지(느낌 칩·「없어요」·「아직 안 정했어요」)는 그대로 두고, 글이 빈 AI 줄은 서버가 지운다.
 * 질문 3에 글을 새로 쓰면 「아직 안 정했어요」는 풀린다 — 이제 정한 것이 있다.
 */
export function buildUpdate(journal: PracticeJournal, edit: JournalEdit): JournalUpdateBody {
  const text = (value: string) => value.trim() || null;
  const { answers } = journal;
  const feelingChoice = answers.feeling?.choice ?? null;
  const feelingBody = text(edit.feelingText);
  const unknownBody = text(edit.unknown);
  const nextBody = text(edit.next);
  return {
    answers: {
      feeling: feelingChoice || feelingBody ? { choice: feelingChoice, text: feelingBody } : null,
      unknown: unknownBody ? { none: false, text: unknownBody } : answers.unknown?.none ? { none: true, text: null } : null,
      next: nextBody ? { undecided: false, text: nextBody } : answers.next?.undecided ? { undecided: true, text: null } : null,
      review: text(edit.review),
    },
    practice: journal.practice.map((line, index) => ({ ...line, text: edit.practice[index] ?? line.text })),
    character: journal.character.map((line, index) => ({ ...line, text: edit.character[index] ?? line.text })),
    feedback: journal.feedback.map((line, index) => ({ ...line, text: edit.feedback[index] ?? line.text })),
  };
}

/** 서버가 404 journal_not_found 로 답했는가 — 일지가 아직 없다는 뜻이다. */
export function isJournalMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'journal_not_found';
}

/** 일지를 읽는다. 아직 없으면 null, 다른 실패는 던진다. */
export async function readOptionalJournal(
  getJournal: (practiceId: string) => Promise<PracticeJournal>,
  practiceId: string,
): Promise<PracticeJournal | null> {
  try {
    return await getJournal(practiceId);
  } catch (error) {
    if (isJournalMissing(error)) return null;
    throw error;
  }
}
