/**
 * 리딩 흐름이 페이지 사이에 넘기는 것. 대본과 회차는 서버에 저장되고(reading.script·reading.session,
 * ADR-031) 여기에는 서버가 돌려준 대본·회차의 기기 캐시와, 확인 화면까지만 잠시 드는 초안, 완료 화면이
 * 보여 줄 결과가 있다. 모두 sessionStorage 라 탭을 닫으면 사라진다 — 대본·회차는 서버에서 다시 받는다.
 */
import type { LineResult, ReadingMode, SessionDetail, SessionStatus } from "@/lib/reading/api-types";
import type { ScriptDraft } from "@/lib/reading/draft";
import type { ScriptLine } from "@/lib/reading/script/parse";

/** 서버에 저장된 대본을 화면이 쓰는 모양으로 든 것 (src/lib/reading/script/from-server.ts) */
export interface StoredScript {
  id: string;
  title: string;
  /** 배역 이름, 등장 순서. 실행 화면과 상태 머신은 이름으로 줄을 가른다. */
  roles: string[];
  lines: ScriptLine[];
  /** 배역 id 와 목소리 — 회차 시작·목소리 저장이 쓴다 */
  characters: { id: string; name: string; voicePreset: string | null }[];
  /** lines 와 같은 순서의 줄 id — 회차의 구간·진행 저장이 쓴다 */
  lineIds: string[];
  /** 열린 회차. 상세의 "이어서 연습"이 쓴다. */
  openSessionId: string | null;
  /** 마지막 회차 요약. 배역 화면의 기본 선택이 이것의 내 배역이다. */
  lastSession: { id: string; status: SessionStatus; myCharacterIds: string[] } | null;
}

/** 배역 화면에서 정한 기기 쪽 설정. 실행 화면이 읽는다. */
export interface RunPrefs {
  /** 상대 대사를 어떻게 낼지 — 모델을 준비하지 못했을 때 배우가 고른 것 */
  partnerVoice: "supertonic" | "device" | "text";
}

/** 암기 화면(R04 대응)의 대상. 진입 경로가 정한다 — 대본에서 오면 고른 배역의 미암기 줄, 완료 화면에서 오면 다시 볼 줄. */
export interface MemorizeEntry {
  scriptId: string;
  roles: string[];
  /** 완료 화면의 다시 볼 대사에서 왔으면 그 줄 id 들. 대본에서 왔으면 null. */
  lineIds: string[] | null;
}

/** 리딩 한 번의 결과. 완료 화면이 보여 준다 — 페이지가 나뉘어 있어 여기 저장해 넘긴다. */
export interface RunStats {
  mode: ReadingMode;
  /** 일시정지를 뺀 흐른 시간 */
  elapsedMs: number;
  /** 구간 안 대사 줄 수(모든 배역) — 부분 구간을 대본 전체 완료로 말하지 않는다 */
  lineCount: number;
  myCharacterNames: string[];
  /** 완료 때의 줄 결과. 다시 볼 대사와 quiz 표기가 여기서 나온다. */
  lineResults: LineResult[];
}

// 1.0.0 이전의 "rehearsal.script"(서버 저장 전, id 없음)와 키를 달리 해 옛 값을 읽지 않는다.
const DRAFT_KEY = "reading.draft";
const SCRIPT_KEY = "reading.script";
const SESSION_KEY = "reading.session";
const STATS_KEY = "reading.stats";
const PREFS_KEY = "reading.run_prefs";
const MEMORIZE_KEY = "reading.memorize";

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
  /** 지금 하는 회차(서버 상세). 시작·이어하기 때 두고 완료·새 대본에서 비운다. */
  loadSession: () => read<SessionDetail>(SESSION_KEY),
  saveSession: (s: SessionDetail | null) => write(SESSION_KEY, s),
  loadStats: () => read<RunStats>(STATS_KEY),
  saveStats: (s: RunStats | null) => write(STATS_KEY, s),
  loadRunPrefs: () => read<RunPrefs>(PREFS_KEY),
  saveRunPrefs: (p: RunPrefs | null) => write(PREFS_KEY, p),
  loadMemorizeEntry: () => read<MemorizeEntry>(MEMORIZE_KEY),
  saveMemorizeEntry: (e: MemorizeEntry | null) => write(MEMORIZE_KEY, e),
};
