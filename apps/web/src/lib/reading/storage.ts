/**
 * 대본과 설정은 sessionStorage까지만 간다. 사용자가 넣는 대본은 대부분 타인의 저작물이라
 * 서버에 올리지 않고, 탭을 닫으면 사라지게 둔다.
 */
import type { ScriptLine } from "@/lib/reading/script/parse";

export interface StoredScript {
  title: string | undefined;
  roles: string[];
  lines: ScriptLine[];
  raw: string;
}

export type AdvanceMode = "silence" | "manual";
export type Mode = "read" | "quiz";

export interface Setup {
  myRole: string;
  start: number;
  end: number;
  mode: Mode;
  advanceMode: AdvanceMode;
}

/** 리딩 한 번의 결과. 완료 화면이 보여 준다 — 페이지가 나뉘어 있어 여기 저장해 넘긴다. */
export interface RunStats {
  mode: Mode;
  elapsedMs: number;
  lineCount: number;
  /** 암기 대조 전용 — 글자 대조 결과만 담는다 */
  quiz?: { attempted: number; passed: number; pending: number };
}

const SCRIPT_KEY = "rehearsal.script";
const SETUP_KEY = "rehearsal.setup";
const STATS_KEY = "rehearsal.stats";

function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장이 막힌 환경(시크릿 등)이면 그냥 메모리만 쓴다 */
  }
}

export const storage = {
  loadScript: () => read<StoredScript>(SCRIPT_KEY),
  saveScript: (s: StoredScript | null) => write(SCRIPT_KEY, s),
  loadSetup: () => read<Setup>(SETUP_KEY),
  saveSetup: (s: Setup | null) => write(SETUP_KEY, s),
  loadStats: () => read<RunStats>(STATS_KEY),
  saveStats: (s: RunStats | null) => write(STATS_KEY, s),
};
