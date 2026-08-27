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

const SCRIPT_KEY = "rehearsal.script";
const SETUP_KEY = "rehearsal.setup";

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
};
