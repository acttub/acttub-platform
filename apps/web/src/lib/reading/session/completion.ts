/**
 * 완료 저장(complete: true) 재시도(reading.session, 조정자 지시 2026-09-21). 완료 저장이 실패하면 같은 progress_seq·
 * complete 요청을 오프라인 재시도와 같은 규칙(늘어나는 간격)으로 다시 보내고, 성공 전에는 완료 화면이 "저장 중"을
 * 보인다. 보내지 못한 요청은 기기(sessionStorage)에 남아 다음 진입 때 다시 시도한다. 닫힌 회차(409)·없는 회차(404)는
 * 그만둔다.
 */
import { ApiError, NetworkError } from "@/lib/api/v2/errors";
import { saveProgress } from "@/lib/api/v2/reading-sessions";
import type { ProgressRequest, ProgressResponse } from "@/lib/reading/api-types";

const STORE_KEY = "reading.pending_completions";
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

type Scheduler = (fn: () => void, ms: number) => () => void;

export interface CompletionDeps {
  send: (sessionId: string, body: ProgressRequest) => Promise<ProgressResponse>;
  schedule?: Scheduler;
}

const REAL: CompletionDeps = { send: (id, body) => saveProgress(id, body) };

const defaultSchedule: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

type Pending = { body: ProgressRequest; retries: number; cancel: (() => void) | null };

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStore(): Record<string, ProgressRequest> {
  try {
    const raw = store()?.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ProgressRequest>) : {};
  } catch {
    return {};
  }
}

function writeStore(): void {
  try {
    const out: Record<string, ProgressRequest> = {};
    for (const [id, p] of pending) out[id] = p.body;
    if (Object.keys(out).length === 0) store()?.removeItem(STORE_KEY);
    else store()?.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
    /* 저장이 막힌 환경이면 메모리만 */
  }
}

function notify(): void {
  for (const cb of listeners) cb();
}

function retryable(cause: unknown): boolean {
  if (cause instanceof NetworkError) return true;
  if (cause instanceof ApiError) return cause.status === 429 || cause.status >= 500;
  return false;
}

function attempt(sessionId: string, deps: CompletionDeps): void {
  const p = pending.get(sessionId);
  if (!p) return;
  const schedule = deps.schedule ?? defaultSchedule;
  p.cancel = schedule(async () => {
    const current = pending.get(sessionId);
    if (!current) return;
    try {
      await deps.send(sessionId, current.body);
      pending.delete(sessionId);
    } catch (cause) {
      if (retryable(cause)) {
        current.retries += 1;
        attempt(sessionId, deps);
        writeStore();
        notify();
        return;
      }
      // 닫힌 회차(409)·없는 회차(404)·규칙 위반 — 더 보내도 달라지지 않는다.
      pending.delete(sessionId);
    }
    writeStore();
    notify();
  }, p.retries === 0 ? 0 : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (p.retries - 1)));
}

/** 완료 저장이 실패했다. 같은 본문을 다시 보내기 시작한다(첫 시도는 곧바로). */
export function startCompletionRetry(sessionId: string, body: ProgressRequest, deps: CompletionDeps = REAL): void {
  pending.get(sessionId)?.cancel?.();
  pending.set(sessionId, { body, retries: 0, cancel: null });
  writeStore();
  notify();
  attempt(sessionId, deps);
}

export function completionPending(sessionId: string): boolean {
  return pending.has(sessionId);
}

export function subscribeCompletion(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 새 페이지에서 기기에 남은 완료 저장을 이어서 시도한다. */
export function resumeCompletionRetries(deps: CompletionDeps = REAL): void {
  for (const [sessionId, body] of Object.entries(readStore())) {
    if (pending.has(sessionId)) continue;
    pending.set(sessionId, { body, retries: 0, cancel: null });
    attempt(sessionId, deps);
  }
  notify();
}

/** 테스트용. clearStore=false 면 기기 저장소는 남긴다(새 페이지 흉내). */
export function _resetCompletion(clearStore = true): void {
  for (const p of pending.values()) p.cancel?.();
  pending.clear();
  listeners.clear();
  if (clearStore) {
    try {
      store()?.removeItem(STORE_KEY);
    } catch {
      /* 없음 */
    }
  }
}
