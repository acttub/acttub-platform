/**
 * 암기 화면(R04·R04.1, reading.memorization)의 순수 규칙 — 대상, 가림, 외워서 말해보기. 웹
 * `memorization/{targets,masking,recital}.ts` 와 같은 규칙이다. 화면·오디오·서버를 모른다.
 *
 * 대상은 진입 경로가 정한다. 대본에서 들어오면 화면이 고른 배역의 대사 가운데 memorized 가 아닌 줄(행 없음 포함),
 * 완료 화면의 다시 볼 대사에서 들어오면 그 줄들(memorized 여도 열고 표시는 자동으로 바꾸지 않는다).
 * 가림은 같은 대사에서 언제나 같다(무작위 없음). 괄호 지문은 가림과 대조 대상에서 뺀다.
 * 외웠는지는 배우가 정한다 — 대조 통과를 자동으로 "외웠어요"로 쓰지 않는다.
 */
import { compareLine } from './match.ts';
import type { ScriptLine } from './parse.ts';
import { dialogueNumbers } from './session-plan.ts';
import type { LineMemorization } from './types.ts';
import { translate as t } from '../i18n.ts';

// ─── 대상 ─────────────────────────────────────────────────────────────────────

export type TargetLine = {
  lineId: string;
  index: number;
  dialogueNo: number;
  role: string;
  text: string;
  memorized: boolean;
  /** 바로 전 상대 대사 — 화면이 함께 보여 준다. */
  previousPartner: { role: string; text: string } | null;
};

export type MemorizationTargets = {
  lines: TargetLine[];
  /** 내 대사 가운데 memorized 인 줄 수 */
  memorizedCount: number;
  /** 내 대사 수 */
  total: number;
};

export function memorizationTargets(
  script: { lines: ScriptLine[]; lineIds: string[] },
  myRoles: string[],
  entries: Pick<LineMemorization, 'line_id' | 'status'>[],
  options: { includeMemorized?: boolean; onlyLineIds?: string[] } = {},
): MemorizationTargets {
  const mine = new Set(myRoles);
  const status = new Map(entries.map((e) => [e.line_id, e.status] as const));
  const only = options.onlyLineIds ? new Set(options.onlyLineIds) : null;
  const numbers = dialogueNumbers(script.lines);
  const lines: TargetLine[] = [];
  let memorizedCount = 0;
  let total = 0;
  let lastPartner: { role: string; text: string } | null = null;
  script.lines.forEach((l, i) => {
    if (l.type !== 'dialogue') return;
    const lineId = script.lineIds[i];
    if (!mine.has(l.role)) {
      lastPartner = { role: l.role, text: l.text };
      return;
    }
    total += 1;
    const memorized = status.get(lineId) === 'memorized';
    if (memorized) memorizedCount += 1;
    const wanted = only ? only.has(lineId) : options.includeMemorized || !memorized;
    if (wanted) lines.push({ lineId, index: i, dialogueNo: numbers[i] ?? 0, role: l.role, text: l.text, memorized, previousPartner: lastPartner });
  });
  return { lines, memorizedCount, total };
}

/** "니나 역 · 암기하지 못한 대사 N개" */
export function memorizationHeading(myRoles: string[], count: number): string {
  return t('reading.memoHeading', { roles: myRoles.join(', '), count });
}

/** "외운 줄 K / 내 대사 N" — 대본 카드(R00)에는 두지 않는다. */
export function memorizationProgress(targets: Pick<MemorizationTargets, 'memorizedCount' | 'total'>): string {
  return t('reading.memoProgress', { k: targets.memorizedCount, n: targets.total });
}

// ─── 가림 ─────────────────────────────────────────────────────────────────────

export type MemoMode = 'hidden' | 'blanks' | 'initials' | 'listen';

export const MEMO_MODES: { value: MemoMode; label: string }[] = [
  { value: 'hidden', label: t('reading.memoModeHidden') },
  { value: 'blanks', label: t('reading.memoModeBlanks') },
  { value: 'initials', label: t('reading.memoModeInitials') },
  { value: 'listen', label: t('reading.memoModeListen') },
];

export type MaskToken = {
  kind: 'word' | 'direction';
  text: string;
  masked: boolean;
  /** 가려진 어절에서 보여 주는 글자(첫 글자 힌트). 가리지 않았으면 text 그대로. */
  shown: string;
};

const DIRECTION_RE = /^[(（[【][^)）\]】]*[)）\]】]$/;

/**
 * 가리고 연습은 본문을 다 가리고, 빈칸 연습은 둘째·넷째… 어절을 가리고, 첫 글자는 가린 어절의 첫 글자를 남긴다.
 * 듣고 따라 하기는 재생하는 동안 본문을 가린다. 괄호 지문은 가리지 않는다.
 */
export function maskTokens(text: string, mode: MemoMode, options: { hint?: boolean } = {}): MaskToken[] {
  const pieces = text.split(/\s+/).filter(Boolean);
  const showInitial = mode === 'initials' || options.hint === true;
  let wordIndex = 0;
  return pieces.map((piece) => {
    if (DIRECTION_RE.test(piece)) return { kind: 'direction', text: piece, masked: false, shown: piece };
    const i = wordIndex++;
    const masked = mode === 'blanks' || mode === 'initials' ? i % 2 === 1 : true;
    const shown = !masked ? piece : showInitial ? (Array.from(piece)[0] ?? '') : '';
    return { kind: 'word', text: piece, masked, shown };
  });
}

/** 글자 하나를 밑줄 하나로 — 화면과 테스트가 같은 모양을 본다. */
export function renderMasked(text: string, mode: MemoMode, options: { hint?: boolean } = {}): string {
  return maskTokens(text, mode, options)
    .map((tok) => (tok.masked ? tok.shown + '_'.repeat(Math.max(0, Array.from(tok.text).length - Array.from(tok.shown).length)) : tok.text))
    .join(' ');
}

// ─── 외워서 말해보기 ──────────────────────────────────────────────────────────

export const MAX_RECITAL_MISS = 2;

export type RecitalOutcome =
  | { kind: 'pass' }
  /** 미달, 같은 줄에 머문다("다시·원문 보기") */
  | { kind: 'retry'; misses: number }
  /** 2회 미달 — 안내 없이 다음 줄 */
  | { kind: 'advance'; misses: number }
  /** 인식 불가·무발화·길이 상한 초과 — 세지 않는다 */
  | { kind: 'nothing' };

/** 말한 것을 원문과 대조한다(match.ts: 정규화 · 자모 편집거리 · 0.72). 결과에 점수·맞음·틀림은 없다. */
export function recite(said: string, target: string, missesSoFar: number): RecitalOutcome {
  const result = compareLine(said, target);
  if (result.kind === 'no_speech' || result.kind === 'too_long') return { kind: 'nothing' };
  if (result.kind === 'pass') return { kind: 'pass' };
  const misses = missesSoFar + 1;
  return misses >= MAX_RECITAL_MISS ? { kind: 'advance', misses } : { kind: 'retry', misses };
}
