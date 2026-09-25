/**
 * 진행 저장 큐(reading.session). 줄이 바뀔 때·일시정지·나가기·완료 때 기기가 마지막 위치를 보낸다.
 * 저장이 실패해도(오프라인) 기기는 계속 진행하고 마지막 위치를 들고 있다가 다음 저장 때 보낸다 — 밀린
 * 저장은 하나로 합친다(서버는 순번이 큰 요청만 반영하므로 마지막 값만 의미가 있다).
 *
 * 순번(progress_seq)은 보낼 때마다 1씩 늘려 단조 증가한다. completed·stopped 회차의 409 session_closed 와
 * 없어진 회차의 404 는 다시 보내지 않는다.
 */
import { ApiError, NetworkError, RequestAbortError } from '../api-request.ts';
import type { ProgressBody, ProgressResponse } from './types.ts';

export type ProgressPayload = Omit<ProgressBody, 'progress_seq'>;

export type ProgressQueueDependencies = {
  send: (body: ProgressBody) => Promise<ProgressResponse>;
  /** 서버가 이미 아는 순번. 이어하기는 회차의 progress_seq 부터 잇는다. */
  initialSeq?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  onSaved?: (response: ProgressResponse) => void;
  /** 409 session_closed — 회차가 끝났다. 화면이 안내한다. */
  onClosed?: () => void;
  onError?: (error: unknown) => void;
};

export function createProgressQueue(deps: ProgressQueueDependencies) {
  let seq = deps.initialSeq ?? 0;
  let pending: ProgressPayload | null = null;
  let inFlight = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const waiters: (() => void)[] = [];
  const baseDelay = deps.retryDelayMs ?? 2_000;
  const maxDelay = deps.maxRetryDelayMs ?? 30_000;

  function settleWaiters() {
    if (pending !== null || inFlight) return;
    const list = waiters.splice(0);
    for (const w of list) w();
  }

  function isPermanent(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error instanceof NetworkError || error instanceof RequestAbortError) return false;
    // 409 session_closed·404·422 는 같은 본문을 다시 보내도 답이 같다.
    return error.status === 409 || error.status === 404 || error.status === 422 || error.status === 403;
  }

  async function drain(): Promise<void> {
    if (disposed || inFlight || pending === null) return;
    inFlight = true;
    const body: ProgressBody = { progress_seq: ++seq, ...pending };
    pending = null;
    try {
      const response = await deps.send(body);
      attempt = 0;
      deps.onSaved?.(response);
    } catch (error) {
      if (isPermanent(error)) {
        if (error instanceof ApiError && error.code === 'session_closed') deps.onClosed?.();
        deps.onError?.(error);
        pending = null;
      } else {
        // 다시 시도 — 그사이 새 위치가 들어왔으면 그것이 이긴다.
        if (pending === null) pending = stripSeq(body);
        attempt += 1;
        const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
        timer = setTimeout(() => {
          timer = null;
          void drain();
        }, delay);
        deps.onError?.(error);
      }
    } finally {
      inFlight = false;
      if (pending !== null && timer === null) void drain();
      settleWaiters();
    }
  }

  function stripSeq(body: ProgressBody): ProgressPayload {
    const { progress_seq: _seq, ...rest } = body;
    return rest;
  }

  return {
    /** 마지막 위치를 들고 있다가 보낸다. 앞선 것이 아직 안 나갔으면 합친다. */
    push(payload: ProgressPayload): void {
      if (disposed) return;
      pending = { ...(pending ?? {}), ...payload };
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      void drain();
    },
    pending(): ProgressPayload | null {
      return pending;
    },
    seq(): number {
      return seq;
    },
    /** 밀린 저장이 다 나갈 때까지. 테스트와 나가기가 기다린다. */
    flushed(): Promise<void> {
      if (pending === null && !inFlight) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      settleWaiters();
    },
  };
}

export type ProgressQueue = ReturnType<typeof createProgressQueue>;
