/**
 * 리허설 진행 상태머신. 순수 함수 — DOM·오디오를 모른다.
 *
 * idle ─begin→ ai | me ─advance→ … ─advance→ done
 *              ai | me ─pause→ paused ─resume→ (원래 상태)
 *
 * 지문(direction)과 장면(scene)은 화면에만 보이고 진행에서는 건너뛴다.
 */
import type { DialogueLine, ScriptLine } from "@/lib/reading/script/parse";

export type Status = "idle" | "ai" | "me" | "paused" | "done";
export type Turn = "ai" | "me";

export interface RehearsalConfig {
  lines: ScriptLine[];
  /** 내 배역(하나 이상). 나머지 배역의 대사는 기기가 읽는다(reading.cast). */
  myRoles: string[];
  /** 포함, 0-based. lines 인덱스 */
  start: number;
  /** 포함, 0-based */
  end: number;
  /**
   * 이어하기: 여기서부터 시작한다(포함). 없으면 start 부터. 이어하기는 현재 줄 직전의 상대 대사 하나를
   * 먼저 읽어 흐름을 잡아 주므로, 부르는 쪽이 그 상대 줄의 인덱스를 준다.
   */
  from?: number;
}

export interface RehearsalState extends RehearsalConfig {
  index: number;
  status: Status;
  /** paused일 때 돌아갈 상태 */
  resumeTo: Turn | null;
}

function nextDialogueIndex(lines: ScriptLine[], from: number, end: number): number {
  for (let i = from; i <= end && i < lines.length; i++) {
    if (lines[i].type === "dialogue") return i;
  }
  return -1;
}

export function turnOf(state: RehearsalConfig, index: number): Turn {
  const line = state.lines[index];
  return line?.type === "dialogue" && state.myRoles.includes(line.role) ? "me" : "ai";
}

export function createRehearsal(cfg: RehearsalConfig): RehearsalState {
  const start = Math.max(0, cfg.start);
  const end = Math.min(cfg.lines.length - 1, cfg.end);
  const from = cfg.from === undefined ? start : Math.min(Math.max(start, cfg.from), end);
  const index = nextDialogueIndex(cfg.lines, from, end);
  if (index < 0) return { ...cfg, start, end, index: end, status: "done", resumeTo: null };
  return { ...cfg, start, end, index, status: "idle", resumeTo: null };
}

export function begin(state: RehearsalState): RehearsalState {
  if (state.status !== "idle") return state;
  return { ...state, status: turnOf(state, state.index) };
}

export function advance(state: RehearsalState): RehearsalState {
  if (state.status === "done") return state;
  const index = nextDialogueIndex(state.lines, state.index + 1, state.end);
  if (index < 0) return { ...state, status: "done", resumeTo: null };
  return { ...state, index, status: turnOf(state, index), resumeTo: null };
}

export function pause(state: RehearsalState): RehearsalState {
  if (state.status !== "ai" && state.status !== "me") return state;
  return { ...state, status: "paused", resumeTo: state.status };
}

export function resume(state: RehearsalState): RehearsalState {
  if (state.status !== "paused" || !state.resumeTo) return state;
  return { ...state, status: state.resumeTo, resumeTo: null };
}

export function restart(state: RehearsalState): RehearsalState {
  return begin(createRehearsal({ ...state, from: undefined }));
}

export function progress(state: RehearsalState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (let i = state.start; i <= state.end; i++) {
    if (state.lines[i]?.type !== "dialogue") continue;
    total++;
    if (i < state.index || state.status === "done") done++;
  }
  return { done, total };
}

export interface RehearsalWindow {
  past: ScriptLine[];
  current: DialogueLine | null;
  next: DialogueLine | null;
  /** 현재 줄 바로 앞에 있는 지문들 (현재 줄 위에 얇게 보여 준다) */
  leadingDirections: string[];
}

export function window(state: RehearsalState): RehearsalWindow {
  const past = state.lines.slice(state.start, state.index);
  const cur = state.lines[state.index];
  const current = state.status !== "done" && cur?.type === "dialogue" ? cur : null;
  const ni = nextDialogueIndex(state.lines, state.index + 1, state.end);
  const next = ni >= 0 ? (state.lines[ni] as DialogueLine) : null;
  const leadingDirections: string[] = [];
  for (let i = state.index - 1; i >= state.start; i--) {
    const l = state.lines[i];
    // 장면 줄(막·장 머리)도 대사가 아니므로 지문처럼 현재 줄 위에 보여 준다.
    if (l.type === "dialogue") break;
    leadingDirections.unshift(l.text);
  }
  return { past, current, next, leadingDirections };
}
