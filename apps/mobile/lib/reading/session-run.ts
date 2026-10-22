/**
 * 리딩 실행(R9, reading.session)의 진행 상태 — 순수 함수. 화면·오디오·서버를 모른다.
 *
 * 지문·장면은 화면에만 보이고 진행에서 건너뛴다. 진행 "K / N · mm:ss"의 N 은 구간 안 대사 줄 수(모든 배역),
 * K 는 지난 대사 수, 시간은 일시정지를 뺀 흐른 시간이다. 내 줄마다 말한 것(음성 인식 결과)만 남겨 진행 저장에 싣고,
 * 원문과의 비교는 서버가 한다. 같은 줄을 다시 말하면 마지막 말이 이긴다. 말한 것은 흐름에 끼어들지 않는다.
 */
import type { LineSaid, ScriptLine } from './types.ts';
import type { MaskMode } from './store.ts';
import { lineGroups, type LineGroup } from './line-groups.ts';
import { alignSentences } from './monologue.ts';
import { translate as t } from '../i18n.ts';

export type RunStatus = 'mine' | 'partner' | 'paused' | 'done';

export type RunConfig = {
  lines: ScriptLine[];
  lineIds: string[];
  myRoles: string[];
  startIndex: number;
  endIndex: number;
  /** 독백 대본이면 같은 배역 연속 대사를 묶지 않는다(SOMA-806). */
  monologue?: boolean;
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

/** 줄이 속한 같은 배역 묶음을 구간으로 자른 것(SOMA-806). 묶음은 한 차례다. */
function groupOf(run: RunConfig, index: number): LineGroup {
  const g = lineGroups(run.lines, { monologue: !!run.monologue }).find((x) => x.start <= index && index <= x.end) ?? { start: index, end: index };
  return { start: Math.max(g.start, run.startIndex), end: Math.min(g.end, run.endIndex) };
}

/** 지금 차례의 줄 — 지금 줄부터 그 묶음 끝까지. 상대 차례는 이어서 읽고, 내 차례는 한 번에 말한다. */
export function turnSpan(run: RunState): LineGroup {
  return { start: run.index, end: Math.max(run.index, groupOf(run, run.index).end) };
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
  const next = nextDialogue(run.lines, turnSpan(run).end + 1, run.endIndex);
  if (next < 0) return { ...run, index: run.endIndex + 1, status: 'done', resumeTo: null, leadInUntil: null };
  const leadInUntil = run.leadInUntil !== null && next >= run.leadInUntil ? null : run.leadInUntil;
  const moved: RunState = { ...run, index: next, leadInUntil, resumeTo: null };
  return { ...moved, status: turnOf(moved) };
}

function prevDialogue(lines: ScriptLine[], from: number, start: number): number {
  for (let i = from; i >= start; i--) if (lines[i]?.type === 'dialogue') return i;
  return -1;
}

/** 바로 앞 차례의 첫 줄. 없으면 -1. */
function prevTurn(run: RunState): number {
  const prev = prevDialogue(run.lines, run.index - 1, run.startIndex);
  return prev < 0 ? -1 : groupOf(run, prev).start;
}

/** [이전]을 누를 수 있나 — 진행 중이고 구간 안에 앞 대사가 있을 때만. */
export function canGoBack(run: RunState): boolean {
  if (run.status !== 'mine' && run.status !== 'partner') return false;
  return prevTurn(run) >= 0;
}

/**
 * 바로 앞 대사 줄로 돌아간다(지문·장면은 건너뜀). 그 줄을 처음부터 다시 한다 — 상대 줄이면 다시 읽고 내 줄이면 다시
 * 듣는다. 말한 것은 남고 다시 말하면 마지막 말이 이긴다.
 */
export function back(run: RunState): RunState {
  if (!canGoBack(run)) return run;
  const index = prevTurn(run);
  const moved: RunState = { ...run, index, resumeTo: null };
  return { ...moved, status: turnOf(moved) };
}

/**
 * 지나간 대사를 눌러 그 줄로 간다(SOMA-785, 음악 앱의 가사 누르기). [이전]과 같은 규칙이다 — 그 줄을 처음부터 다시 하고
 * (상대 줄이면 다시 읽고 내 줄이면 다시 듣는다), 말한 것은 남되 다시 말하면 마지막 말이 이긴다. 멈춘 채 눌러도 그 줄에서
 * 이어서 한다. 구간 밖·대사가 아닌 줄·지금 줄 뒤·끝난 실행은 받지 않는다. 이어하기의 앞 상대 대사보다 앞으로 가도 위치를 저장한다.
 */
export function jumpTo(run: RunState, index: number): RunState {
  if (run.status === 'done' || index < run.startIndex || index >= run.index || run.lines[index]?.type !== 'dialogue') return run;
  // 묶인 대사 안의 줄을 눌러도 그 묶음 처음부터 — 묶음이 한 차례다.
  const moved: RunState = { ...run, index: groupOf(run, index).start, resumeTo: null, leadInUntil: null };
  return { ...moved, status: turnOf(moved) };
}

/**
 * 리딩 중 줄 고치기(SOMA-728) — 고친 대본을 진행에 반영한다. 줄 id 는 그대로라 위치는 같은 줄이다. 그 줄이 대사가 아니게
 * 되면 다음 대사로(없으면 앞 대사로, 그마저 없으면 끝). 대사가 아니게 된 줄의 말한 기록은 버린다 — 서버가 대사 줄이 아닌
 * 결과를 422 로 거절해 진행 저장이 통째로 막힌다. 멈춘 상태는 그대로 두고, 재개할 때 차례를 새로 정한다.
 */
export function applyLineEdit(run: RunState, next: Pick<RunConfig, 'lines' | 'lineIds' | 'myRoles'>): RunState {
  const said: Record<string, string> = {};
  next.lineIds.forEach((id, i) => {
    if (run.said[id] !== undefined && next.lines[i]?.type === 'dialogue') said[id] = run.said[id];
  });
  const base: RunState = { ...run, ...next, said };
  if (run.status === 'done') return base;
  let index = nextDialogue(next.lines, run.index, run.endIndex);
  if (index < 0) index = prevDialogue(next.lines, run.index - 1, run.startIndex);
  if (index < 0) return { ...base, index: run.endIndex + 1, status: 'done', resumeTo: null, leadInUntil: null };
  const moved: RunState = { ...base, index };
  if (run.status === 'paused') return { ...moved, resumeTo: null };
  return { ...moved, status: turnOf(moved), resumeTo: null };
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

/**
 * 지금 내 차례에 말한 것을 남긴다. 흐름은 그대로다. 묶인 차례(SOMA-806)는 한 번에 받아쓴 글을 독백과 같은 글자 맞춤
 * (alignSentences)으로 줄마다 떼어 줄별로 남긴다 — 서버 대조가 줄마다 말한 것을 받기 때문이다. 빠뜨린 줄은 남기지 않고,
 * 어느 줄에도 맞지 않으면 전체를 첫 줄의 말한 것으로 둔다(따로 말했을 때 그 줄이 다르게 말한 대사가 되는 것과 같게).
 */
export function recordSaid(run: RunState, said: string): RunState {
  if (run.status !== 'mine') return run;
  const { start, end } = turnSpan(run);
  if (start === end) return { ...run, said: { ...run.said, [run.lineIds[start]]: said } };
  const ids = run.lineIds.slice(start, end + 1);
  const pieces: Record<string, string> = {};
  alignSentences(run.lines.slice(start, end + 1).map((l) => l.text), said).forEach((a, k) => {
    if (a.status !== 'missed' && a.said) pieces[ids[k]] = a.said;
  });
  if (!Object.keys(pieces).length) pieces[ids[0]] = said;
  return { ...run, said: { ...run.said, ...pieces } };
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
    if (!isMine(run, i)) leadIn = groupOf(run, i).start;
    break;
  }
  const index = leadIn >= 0 ? leadIn : at;
  const next: RunState = { ...run, index, leadInUntil: leadIn >= 0 ? at : null };
  return { ...next, status: turnOf(next) };
}

/**
 * 나가기 확인 — "지금 나가면 N번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요."
 * N 은 화면 위 "K / N" 의 K 와 같은 기준(고른 구간 안에서 끝낸 대사 수)이다. 대본 전체 번호를 쓰면 장면 2의
 * 2번째 줄에서 "13번"처럼 화면과 달라진다. 저장되는 위치(current_line_id)는 줄 id 라 번호 기준과 무관하다.
 */
export function exitMessage(run: RunState, opts?: { discard?: boolean }): string {
  if (opts?.discard) return t('reading.exitConfirmBodyUnsaved');
  return t('reading.exitConfirmBody', { n: progressOf(run).done });
}

/**
 * [시작]을 누르기 전에 나가면 이번 회차를 남기지 않는다(지운다). 회차는 R8 「새 연습」에서 이미 만들어져 있어, 그대로 두면
 * 상세 목록·이어 읽기에 「진행 중 · 0/N」이 쌓인다. 이어하기(진행 저장이 있는 회차)·녹음이 있는 회차·서버가 닫은 회차는 건드리지 않는다.
 */
export function discardOnExit(input: { started: boolean; progressSeq: number; recordingCount: number; closed: boolean }): boolean {
  return !input.started && !input.closed && input.progressSeq === 0 && input.recordingCount === 0;
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
