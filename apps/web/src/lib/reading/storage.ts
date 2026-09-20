/**
 * 리딩 흐름이 페이지 사이에 넘기는 것. 대본은 서버에 저장되고(reading.script, ADR-031) 여기에는
 * 서버가 돌려준 대본의 기기 캐시와, 확인 화면까지만 잠시 드는 초안, 리딩 설정·결과가 있다.
 * 모두 sessionStorage 라 탭을 닫으면 사라진다 — 대본은 서버에서 다시 받는다.
 */
import type { ScriptDraft } from "@/lib/reading/draft";
import type { ScriptLine } from "@/lib/reading/script/parse";

/** 서버에 저장된 대본을 화면이 쓰는 모양으로 든 것 (src/lib/reading/script/from-server.ts) */
export interface StoredScript {
  id: string;
  title: string;
  /** 배역 이름, 등장 순서. 실행 화면과 상태 머신은 이름으로 줄을 가른다. */
  roles: string[];
  lines: ScriptLine[];
  raw: string;
  /** 배역 id — 목소리 저장·회차 시작이 쓴다 */
  characters: { id: string; name: string }[];
  /** lines 와 같은 순서의 줄 id — 회차의 구간·진행 저장이 쓴다 */
  lineIds: string[];
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

// 1.0.0 이전의 "rehearsal.script"(서버 저장 전, id 없음)와 키를 달리 해 옛 값을 읽지 않는다.
const DRAFT_KEY = "reading.draft";
const SCRIPT_KEY = "reading.script";
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
  /** 대본 넣기(D13) → 확인(D16) 사이에만 드는 초안. 저장하거나 화면을 떠나면 버린다. */
  loadDraft: () => read<ScriptDraft>(DRAFT_KEY),
  saveDraft: (d: ScriptDraft | null) => write(DRAFT_KEY, d),
  loadScript: () => read<StoredScript>(SCRIPT_KEY),
  saveScript: (s: StoredScript | null) => write(SCRIPT_KEY, s),
  loadSetup: () => read<Setup>(SETUP_KEY),
  saveSetup: (s: Setup | null) => write(SETUP_KEY, s),
  loadStats: () => read<RunStats>(STATS_KEY),
  saveStats: (s: RunStats | null) => write(STATS_KEY, s),
};
