/**
 * 상대역 목소리 저장(reading.cast). 배역 화면에서 고른 프리셋은 PATCH 로 대본에 남는다. 저장 요청이
 * 실패하면 기기는 이번 회차에서만 그 목소리로 읽고, 다음에 배역 화면에 들어올 때 다시 저장을 시도한다.
 * 보내지 못한 값은 대본별로 기기 저장소에 둔다.
 */
import { updateScript } from "@/lib/api/v2/reading-scripts";

const PENDING_KEY = "acttub.reading.pending_voices";

type Pending = Record<string, Record<string, string | null>>;

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPending(): Pending {
  try {
    const raw = store()?.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Pending) : {};
  } catch {
    return {};
  }
}

function writePending(p: Pending): void {
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* 저장이 막힌 환경이면 이번 회차만 기억한다 */
  }
}

export function pendingVoicePresets(scriptId: string): Record<string, string | null> {
  return readPending()[scriptId] ?? {};
}

function rememberPending(scriptId: string, characterId: string, preset: string | null): void {
  const all = readPending();
  all[scriptId] = { ...(all[scriptId] ?? {}), [characterId]: preset };
  writePending(all);
}

function forgetPending(scriptId: string, characterIds: string[]): void {
  const all = readPending();
  const rest = { ...(all[scriptId] ?? {}) };
  for (const id of characterIds) delete rest[id];
  if (Object.keys(rest).length === 0) delete all[scriptId];
  else all[scriptId] = rest;
  writePending(all);
}

export type SaveVoiceDeps = { update: typeof updateScript };
const REAL: SaveVoiceDeps = { update: updateScript };

/**
 * 프리셋 하나를 저장한다. 실패해도 던지지 않고 false 를 준다 — 화면은 고른 값으로 이번 회차를 읽고,
 * 값은 다음 진입 때 `retryPendingVoicePresets` 가 다시 보낸다.
 */
export async function saveVoicePreset(
  scriptId: string,
  characterId: string,
  preset: string | null,
  deps: SaveVoiceDeps = REAL,
): Promise<boolean> {
  try {
    await deps.update(scriptId, { characters: [{ id: characterId, voice_preset: preset }] });
    forgetPending(scriptId, [characterId]);
    return true;
  } catch {
    rememberPending(scriptId, characterId, preset);
    return false;
  }
}

/** 지난번에 보내지 못한 값을 한 요청으로 다시 보낸다. 성공하면 기기 기록을 지운다. */
export async function retryPendingVoicePresets(scriptId: string, deps: SaveVoiceDeps = REAL): Promise<boolean> {
  const pending = pendingVoicePresets(scriptId);
  const ids = Object.keys(pending);
  if (ids.length === 0) return true;
  try {
    await deps.update(scriptId, { characters: ids.map((id) => ({ id, voice_preset: pending[id] })) });
    forgetPending(scriptId, ids);
    return true;
  } catch {
    return false;
  }
}
