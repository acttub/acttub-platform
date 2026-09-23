/**
 * 녹음 올리기 큐(reading.recording). 회차의 진행 저장과 분리돼 다음 줄을 막지 않는다. 실패(오프라인, 503
 * audio_conversion_failed)하면 파일과 요청 id 를 들고 있다가 같은 요청 id 로 다시 시도하고, 회차가 끝난 뒤에도
 * 남은 파일을 이어서 시도한다. 7일 지난 파일은 버린다. 422·404 는 다시 보내지 않는다(회차가 지워졌으면 녹음이
 * 되살아나지 않는다). 서버 저장이 끝나기 전에 탭을 닫으면 "저장 중인 녹음이 있어요"를 알린다.
 * 웹은 큐를 메모리에 둔다 — 탭을 닫으면 사라지므로 닫기 전에 알리는 것이다.
 */
import { ApiError, errorMessage, NetworkError } from "@/lib/api/v2/errors";
import type { RecordingUploadInput } from "@/lib/api/v2/reading-recordings";
import type { SessionRecording } from "@/lib/reading/api-types";

export const RECORDING_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_UNLOAD_COPY = "저장 중인 녹음이 있어요";
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export interface PendingRecording extends RecordingUploadInput {
  sessionId: string;
  createdAt: number;
}

export interface RecordingQueue {
  enqueue(item: PendingRecording): void;
  /** 지금 보낼 수 있는 것을 순서대로 보낸다. 실패해도 던지지 않는다. */
  flush(): Promise<void>;
  pending(): number;
  subscribe(cb: (pending: number) => void): () => void;
}

type Scheduler = (fn: () => void | Promise<void>, ms: number) => () => void;

interface UnloadWindow {
  addEventListener(name: "beforeunload", cb: (e: BeforeUnloadEvent) => void): void;
  removeEventListener(name: "beforeunload", cb: (e: BeforeUnloadEvent) => void): void;
}

/** 다시 보내면 되는 실패인가. 연결·변환·잠시 뒤·서버 쪽 문제는 그렇고, 규칙 위반(422)·없음(404)·권한은 아니다. */
function retryable(cause: unknown): boolean {
  if (cause instanceof NetworkError) return true;
  if (cause instanceof ApiError) return cause.status === 429 || cause.status >= 500;
  return false;
}

export function createRecordingQueue(deps: {
  send: (item: PendingRecording) => Promise<unknown>;
  now?: () => number;
  schedule?: Scheduler;
  /** 버린 녹음의 안내 문구 */
  onNotice?: (message: string) => void;
  window?: UnloadWindow | null;
}): RecordingQueue {
  const now = deps.now ?? (() => Date.now());
  const schedule: Scheduler =
    deps.schedule ??
    ((fn, ms) => {
      const t = setTimeout(() => void fn(), ms);
      return () => clearTimeout(t);
    });
  const win = deps.window === undefined ? (typeof window === "undefined" ? null : window) : deps.window;

  const items: PendingRecording[] = [];
  const listeners = new Set<(pending: number) => void>();
  let flushing: Promise<void> | null = null;
  let retries = 0;
  let cancelRetry: (() => void) | null = null;

  const notify = () => {
    for (const cb of listeners) cb(items.length);
    syncUnload();
  };

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (items.length === 0) return;
    e.preventDefault();
    e.returnValue = PENDING_UNLOAD_COPY;
  };
  let unloadArmed = false;
  const syncUnload = () => {
    if (!win) return;
    if (items.length > 0 && !unloadArmed) {
      win.addEventListener("beforeunload", onBeforeUnload);
      unloadArmed = true;
    } else if (items.length === 0 && unloadArmed) {
      win.removeEventListener("beforeunload", onBeforeUnload);
      unloadArmed = false;
    }
  };

  const drop = (item: PendingRecording, message?: string) => {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    if (message) deps.onNotice?.(message);
  };

  const run = async () => {
    // 7일 지난 파일은 버린다.
    for (const item of [...items]) if (now() - item.createdAt > RECORDING_KEEP_MS) drop(item);
    while (items.length > 0) {
      const item = items[0];
      try {
        await deps.send(item);
        drop(item);
        retries = 0;
      } catch (cause) {
        if (retryable(cause)) {
          // 뒤에 다시. 이 항목이 앞에 그대로 있으므로 순서는 지켜진다.
          retries += 1;
          const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (retries - 1));
          cancelRetry?.();
          cancelRetry = schedule(() => flush(), delay);
          break;
        }
        drop(item, errorMessage(cause, "이 줄 녹음을 저장하지 못했어요."));
      }
    }
    notify();
  };

  // 보내는 도중에 들어온 항목도 같은 차례에 이어서 보낸다.
  let rerun = false;
  const flush = () => {
    if (flushing) {
      rerun = true;
      return flushing;
    }
    cancelRetry?.();
    cancelRetry = null;
    flushing = (async () => {
      do {
        rerun = false;
        await run();
      } while (rerun && items.length > 0 && !cancelRetry);
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  return {
    enqueue(item) {
      items.push(item);
      notify();
      void flush();
    },
    flush,
    pending: () => items.length,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** 줄마다 시도 번호. 저장된 회차의 녹음(attempt_no)에서 이어 센다. */
export function attemptCounter(existing: Pick<SessionRecording, "line_id" | "attempt_no">[]): { next(lineId: string): number; current(lineId: string): number } {
  const last = new Map<string, number>();
  for (const r of existing) last.set(r.line_id, Math.max(last.get(r.line_id) ?? 0, r.attempt_no));
  return {
    next(lineId) {
      const n = (last.get(lineId) ?? 0) + 1;
      last.set(lineId, n);
      return n;
    },
    current: (lineId) => last.get(lineId) ?? 0,
  };
}

// ─── 앱 전체에 하나뿐인 큐 ───────────────────────────────────────────────────
// 회차가 끝나거나 다른 화면으로 가도 남은 파일을 이어서 보낸다.

let shared: RecordingQueue | null = null;

export function sharedRecordingQueue(create: () => RecordingQueue): RecordingQueue {
  if (!shared) shared = create();
  return shared;
}
