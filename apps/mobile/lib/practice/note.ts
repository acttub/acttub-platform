import { translate } from '../i18n.ts';
import type { NoteKind, NoteQuote, PracticeNote } from './types.ts';

/**
 * 연습 노트 화면의 규칙(practice.note). 노트는 그 회차만 말하고 이전 연습과 견주지 않는다.
 *
 * 보여 주는 순서는 짧은 대화 요약 → 다음 촬영에서 해볼 한 가지 → 응원 문구다(PRD). 비교 기준과
 * 내부 출처 카탈로그는 기본 화면에서 빼고, 제안은 선택·실행으로 바꾸지 않는다. 제목은 초점 문구
 * 원문이고, 초점 없이 끝난 노트(record_only)는 제목이 없어 묶음의 대체 제목을 쓴다.
 */
export const SUMMARY_QUOTE_MAX = 2;

/** 제목이 없는 노트는 묶음 규칙(상황 문장 → "제목 없는 연습")을 따른다. */
export function noteTitle(note: Pick<PracticeNote, 'title'> | null, groupFallback: string): string {
  const title = note?.title?.trim();
  return title || groupFallback;
}

export function noteKindLabel(kind: NoteKind): string {
  return translate(`note.kind.${kind}`);
}

/** 생성이 거듭 실패해 확인된 것만 담은 노트라는 안내. 아니면 없다. */
export function noteFallbackNotice(note: Pick<PracticeNote, 'fallback'>): string | null {
  return note.fallback ? translate('note.fallbackNotice') : null;
}

export type NoteSection =
  | { kind: 'summary'; label: string; quotes: NoteQuote[]; text: string | null }
  | { kind: 'next'; label: string; text: string; hasProposal: boolean }
  | { kind: 'cheer'; label: string; text: string };

/** 인용의 출처를 사람 말로 — 배우가 한 말인지 영상에서 본 것인지. */
export function quoteSourceLabel(source: NoteQuote['source']): string {
  return translate(`note.source.${source}`);
}

export function noteSections(note: PracticeNote): NoteSection[] {
  const quotes = note.summary_quotes.slice(0, SUMMARY_QUOTE_MAX);
  const next = note.next_take?.trim();
  return [
    {
      kind: 'summary',
      label: translate('note.summaryLabel'),
      quotes,
      text: quotes.length === 0 ? translate('note.summaryEmpty') : null,
    },
    {
      kind: 'next',
      label: translate('note.nextLabel'),
      // 근거가 없으면 만들어 넣지 않는다 — 없다고 말한다.
      text: next || translate('note.nextEmpty'),
      hasProposal: Boolean(next),
    },
    {
      kind: 'cheer',
      label: '',
      text: note.cheer?.trim() || translate('note.cheer'),
    },
  ];
}

/** 노트가 없는 회차(대화가 짧아 만들지 않음)의 목록 표시. */
export function noNoteLabel(): string {
  return translate('note.none');
}
