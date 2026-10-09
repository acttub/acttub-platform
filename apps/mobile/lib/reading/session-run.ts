/**
 * 리딩 실행(R9, reading.session)의 진행 상태 — 순수 함수. 화면·오디오·서버를 모른다.
 *
 * 지문·장면은 화면에만 보이고 진행에서 건너뛴다. 진행 "K / N · mm:ss"의 N 은 구간 안 대사 줄 수(모든 배역),
 * K 는 지난 대사 수, 시간은 일시정지를 뺀 흐른 시간이다. 내 줄마다 말한 것(음성 인식 결과)만 남겨 진행 저장에 싣고,
 * 원문과의 비교는 서버가 한다. 같은 줄을 다시 말하면 마지막 말이 이긴다. 말한 것은 흐름에 끼어들지 않는다.
 */
import { dialogueNumbers } from './session-plan.ts';
import type { LineSaid, ScriptLine } from './types.ts';
import type { MaskMode } from './store.ts';
import { translate as t } from '../i18n.ts';

export type RunStatus = 'mine' | 'partner' | 'paused' | 'done';

export type RunConfig = {
  lines: ScriptLine[];
  lineIds: string[];
  myRoles: string[];
  startIndex: number;
  endIndex: number;
};

export type RunState = RunConfig & {
  /** 현재 줄(lines 인덱스). done 이면 endIndex + 1. */
  index: number;
  status: RunStatus;
  /** paused 에서 돌아갈 상태. */
  resumeTo: Exclude<RunStatus, 'paused' | 'done'> | null;
  elapsedMs: number;
  /** 이번 실행에서 내 줄마다 말한 것(줄 id 별). 이어하기 전에 서버에 간 것은 서버가 들고 있어 다시 보내지 않는다. */
  said: Record<string, string>;
  /** 이어하기의 앞 상대 대사 — 이 인덱스 앞까지는 진행 저장을 하지 않는다. */
  leadInUntil: number | null;
};

function nextDialogue(lines: ScriptLine[], from: number, end: number): number {
  for (let i = Math.max(0, from); i <= end && i < lines.length; i++) if (lines[i].type === 'dialogue') return i;
  return -1;
}

function isMine(run: RunConfig, index: number): boolean {
  const line = run.lines[index];
  return line?.type === 'dialogue' && run.myRoles.includes(line.role);
}

export function turnOf(run: RunState): 'mine' | 'partner' {
  return isMine(run, run.index) ? 'mine' : 'partner';
}

export function createRun(cfg: RunConfig): RunState {
  const start = Math.max(0, cfg.startIndex);
  const end = Math.min(cfg.lines.length - 1, cfg.endIndex);
  const index = nextDialogue(cfg.lines, start, end);
  const base = { ...cfg, startIndex: start, endIndex: end, resumeTo: null, elapsedMs: 0, said: {}, leadInUntil: null };
  if (index < 0) return { ...base, index: end + 1, status: 'done' };
  const run: RunState = { ...base, index, status: 'mine' };
  return { ...run, status: turnOf(run) };
}

/** 현재 줄의 서버 id. completed 면 null. */
export function currentLineIdOf(run: RunState): string | null {
  return run.status === 'done' ? null : (run.lineIds[run.index] ?? null);
}

/**
 * 다음 대사 줄로. fromIndex 를 주면 그 줄에서의 넘김만 받는다 — 침묵 완료와 버튼이 겹쳐도 한 줄만 넘어간다.
 */
export function advance(run: RunState, fromIndex?: number): RunState {
  if (run.status === 'done') return run;
  if (fromIndex !== undefined && fromIndex !== run.index) return run;
  const next = nextDialogue(run.lines, run.index + 1, run.endIndex);
  if (next < 0) return { ...run, index: run.endIndex + 1, status: 'done', resumeTo: null, leadInUntil: null };
  const leadInUntil = run.leadInUntil !== null && next >= run.leadInUntil ? null : run.leadInUntil;
  const moved: RunState = { ...run, index: next, leadInUntil, resumeTo: null };
  return { ...moved, status: turnOf(moved) };
}

export function pause(run: RunState): RunState {
  if (run.status !== 'mine' && run.status !== 'partner') return run;
  return { ...run, status: 'paused', resumeTo: run.status };
}

/** 재개 — 그 줄을 처음부터 다시 한다(호출자가 상대 읽기·마이크를 다시 연다). */
export function resume(run: RunState): RunState {
  if (run.status !== 'paused') return run;
  return { ...run, status: run.resumeTo ?? turnOf(run), resumeTo: null };
}

export function tickElapsed(run: RunState, ms: number): RunState {
  if (run.status === 'paused' || run.status === 'done') return run;
  return { ...run, elapsedMs: run.elapsedMs + ms };
}

export function progressOf(run: RunState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (let i = run.startIndex; i <= run.endIndex; i++) {
    if (run.lines[i]?.type !== 'dialogue') continue;
    total += 1;
    if (run.status === 'done' || i < run.index) done += 1;
  }
  return { done, total };
}

export function mmss(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** "K / N · mm:ss" */
export function formatProgress(run: RunState): string {
  const { done, total } = progressOf(run);
  return `${done} / ${total} · ${mmss(run.elapsedMs)}`;
}

/** 지금 내 줄에 말한 것을 남긴다. 흐름은 그대로다. */
export function recordSaid(run: RunState, said: string): RunState {
  if (run.status !== 'mine') return run;
  return { ...run, said: { ...run.said, [run.lineIds[run.index]]: said } };
}

/** 가리기 — 대사에만 적용되고 배역 이름·지문·장면은 남긴다. */
export function isHidden(input: { maskMode: MaskMode; line: ScriptLine; isMine: boolean }): boolean {
  if (input.line.type !== 'dialogue') return false;
  if (input.maskMode === 'all') return true;
  return input.maskMode === 'mine' && input.isMine;
}

/** 가린 내 지금 줄에 쓰는 보조. 그 줄에만 적용되고 다음 줄로 가면 none 으로 돌아간다. */
export type LineAid = 'none' | 'first_word' | 'original';

/** 대사 맨 앞의 괄호 지문들(이어진 것 모두). 괄호 모양은 speakable.ts 와 같다. */
const LEADING_DIRECTIONS = /^(?:[(（[【][^)）\]】]*[)）\]】]\s*)+/;

/**
 * 가린 줄에 보여 줄 글. null 이면 아무 글자도 보이지 않는다(막대). first_word 는 첫 어절만 한 번 — 대사가 괄호 지문으로
 * 시작하면 그 지문과 뒤 한 어절이다. 늘 줄 글의 앞부분이라 화면이 나머지를 막대로 잇는다.
 */
export function shownText(text: string, hidden: boolean, aid: LineAid): string | null {
  if (!hidden || aid === 'original') return text;
  if (aid === 'first_word') {
    const trimmed = text.trim();
    const lead = trimmed.match(LEADING_DIRECTIONS)?.[0] ?? '';
    const word = trimmed.slice(lead.length).split(/\s+/)[0];
    return (lead + word).trimEnd() || null;
  }
  return null;
}

/** 이어하기 — current_line 부터 시작하되 그 줄 직전의 상대 대사 하나를 먼저 읽어 흐름을 잡아 준다. */
export function resumeRun(run: RunState, currentLineId: string): RunState {
  const at = run.lineIds.indexOf(currentLineId);
  if (at < run.startIndex || at > run.endIndex || run.lines[at]?.type !== 'dialogue') return run;
  let leadIn = -1;
  for (let i = at - 1; i >= run.startIndex; i--) {
    if (run.lines[i].type !== 'dialogue') continue;
    if (!isMine(run, i)) leadIn = i;
    break;
  }
  const index = leadIn >= 0 ? leadIn : at;
  const next: RunState = { ...run, index, leadInUntil: leadIn >= 0 ? at : null };
  return { ...next, status: turnOf(next) };
}

/** 나가기 확인 — "지금 나가면 N번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요." */
export function exitMessage(run: RunState): string {
  const numbers = dialogueNumbers(run.lines);
  let last = 0;
  for (let i = run.startIndex; i < run.index && i <= run.endIndex; i++) {
    const n = numbers[i];
    if (n !== null) last = n;
  }
  return t('reading.exitConfirmBody', { n: last });
}

/** 진행 저장 본문(순번은 큐가 붙인다). line_results 는 이번 실행에서 말한 내 줄을 줄 순서로. */
export function progressPayload(run: RunState): {
  current_line_id: string | null;
  elapsed_seconds: number;
  line_results: LineSaid[];
  complete: boolean;
} {
  return {
    current_line_id: currentLineIdOf(run),
    elapsed_seconds: Math.floor(run.elapsedMs / 1000),
    line_results: run.lineIds.filter((id) => run.said[id] !== undefined).map((id) => ({ line_id: id, said: run.said[id] })),
    complete: run.status === 'done',
  };
}
