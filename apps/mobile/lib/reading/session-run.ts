/**
 * 리딩 실행(R9, reading.session)의 진행 상태 — 순수 함수. 화면·오디오·서버를 모른다.
 *
 * 지문·장면은 화면에만 보이고 진행에서 건너뛴다. 진행 "K / N · mm:ss"의 N 은 구간 안 대사 줄 수(모든 배역),
 * K 는 지난 대사 수, 시간은 일시정지를 뺀 흐른 시간이다. 줄별 결과(line_results)는 줄마다 하나이고 마지막
 * 사건이 이긴다. 대조는 흐름에 끼어들지 않는다 — 결과(통과·미달)와 말한 것만 남기고 완료 화면이 쓴다.
 */
import type { ScriptLine } from './parse.ts';
import { latestRecordings } from './recording-plan.ts';
import { dialogueNumbers } from './session-plan.ts';
import type { LineOutcome, LineResult, SessionRecording } from './types.ts';
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

/** 내 줄 하나의 대조 결과. said 는 말한 것(전사)이고 이어하기로 받은 옛 결과는 null 일 수 있다. */
export type RunLineResult = { outcome: LineOutcome; misses: number; said: string | null };

export type RunState = RunConfig & {
  /** 현재 줄(lines 인덱스). done 이면 endIndex + 1. */
  index: number;
  status: RunStatus;
  /** paused 에서 돌아갈 상태. */
  resumeTo: Exclude<RunStatus, 'paused' | 'done'> | null;
  elapsedMs: number;
  results: Record<string, RunLineResult>;
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
  const base = { ...cfg, startIndex: start, endIndex: end, resumeTo: null, elapsedMs: 0, results: {}, leadInUntil: null };
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

/** 내 줄의 대조 결과를 남긴다. 흐름은 그대로다. 미달은 misses 를 하나 늘린다. */
export function recordMatch(run: RunState, match: 'pass' | 'miss', said: string): RunState {
  if (run.status !== 'mine') return run;
  const id = run.lineIds[run.index];
  const prev = run.results[id];
  const misses = (prev?.misses ?? 0) + (match === 'miss' ? 1 : 0);
  return { ...run, results: { ...run.results, [id]: { outcome: match === 'pass' ? 'passed' : 'unmatched', misses, said } } };
}

/** 서버에 보낼 줄별 결과(줄 순서). 말한 것은 녹음 행의 전사로 가므로 여기 넣지 않는다. */
export function lineResultsOf(run: RunState): LineResult[] {
  return run.lineIds
    .filter((id) => run.results[id])
    .map((id) => ({ line_id: id, outcome: run.results[id].outcome, misses: run.results[id].misses }));
}

/**
 * 이어하기 — 서버가 아는 줄별 결과에 녹음의 전사를 붙인다(같은 줄은 가장 큰 attempt_no 가 이긴다). 전사가 없는 줄은
 * said 가 null 이라 완료 화면이 원문만 보인다.
 */
export function resultsFromSession(session: { line_results?: LineResult[] | null; recordings?: Pick<SessionRecording, 'line_id' | 'attempt_no' | 'transcript'>[] | null }): RunState['results'] {
  const latest = latestRecordings(session.recordings ?? []);
  const results: RunState['results'] = {};
  for (const r of session.line_results ?? []) results[r.line_id] = { outcome: r.outcome, misses: r.misses, said: latest.get(r.line_id)?.transcript ?? null };
  return results;
}

/** 가리기 — 대사에만 적용되고 배역 이름·지문·장면은 남긴다. */
export function isHidden(input: { maskMode: MaskMode; line: ScriptLine; isMine: boolean }): boolean {
  if (input.line.type !== 'dialogue') return false;
  if (input.maskMode === 'all') return true;
  return input.maskMode === 'mine' && input.isMine;
}

/** 가린 내 지금 줄에 쓰는 보조. 그 줄에만 적용되고 다음 줄로 가면 none 으로 돌아간다. */
export type LineAid = 'none' | 'first_word' | 'original';

/** 가린 줄에 보여 줄 글. null 이면 아무 글자도 보이지 않는다(막대). first_word 는 첫 어절만 한 번. */
export function shownText(text: string, hidden: boolean, aid: LineAid): string | null {
  if (!hidden || aid === 'original') return text;
  if (aid === 'first_word') return text.trim().split(/\s+/)[0] || null;
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

/** 진행 저장 본문(순번은 큐가 붙인다). */
export function progressPayload(run: RunState): {
  current_line_id: string | null;
  elapsed_seconds: number;
  line_results: LineResult[];
  complete: boolean;
} {
  return {
    current_line_id: currentLineIdOf(run),
    elapsed_seconds: Math.floor(run.elapsedMs / 1000),
    line_results: lineResultsOf(run),
    complete: run.status === 'done',
  };
}
