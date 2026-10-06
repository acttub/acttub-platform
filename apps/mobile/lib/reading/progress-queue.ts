/**
 * 진행 저장 큐(reading.session). 줄이 바뀔 때·일시정지·나가기·완료 때 기기가 마지막 위치를 보낸다.
 * 저장이 실패해도(오프라인) 기기는 계속 진행하고 마지막 위치를 들고 있다가 다음 저장 때 보낸다 — 밀린
 * 저장은 하나로 합친다(서버는 순번이 큰 요청만 반영하므로 마지막 값만 의미가 있다).
 *
 * 순번(progress_seq)은 보낼 때마다 1씩 늘려 단조 증가한다. completed 회차의 409 session_closed 와
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
  /** 409 session_closed — 회차가 끝났다. 화면이 안내한다. */
  onClosed?: () => void;
  /** 첫 저장 전에 기다린다 — 같은 회차의 앞 큐가 보내던 요청이 끝난 뒤에 보낸다. */
  after?: Promise<void>;
};

/** 화면을 떠난 뒤 남은 저장(끊긴 채 끝낸 완료 저장)을 보내 보는 횟수(첫 시도 포함). 백오프로 약 4분이다. */
export const RETIRED_SEND_ATTEMPTS = 12;

/** 같은 본문을 다시 보내도 답이 같은 오류(409 session_closed·404·422·403). 큐는 버리고 다시 보내지 않는다. */
export function isPermanentSaveError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error instanceof NetworkError || error instanceof RequestAbortError) return false;
  return error.status === 409 || error.status === 404 || error.status === 422 || error.status === 403;
}

export function createProgressQueue(deps: ProgressQueueDependencies) {
  let seq = deps.initialSeq ?? 0;
  let pending: ProgressPayload | null = null;
  let inFlight = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let retired = false;
  let gate: Promise<void> | null = deps.after ?? null;
  const waiters: (() => void)[] = [];
  const baseDelay = deps.retryDelayMs ?? 2_000;
  const maxDelay = deps.maxRetryDelayMs ?? 30_000;

  function settleWaiters() {
    if (pending !== null || inFlight) return;
    const list = waiters.splice(0);
    for (const w of list) w();
  }

  async function drain(): Promise<void> {
    if (disposed || inFlight || pending === null) return;
    inFlight = true;
    if (gate) {
      await gate;
      gate = null;
    }
    if (disposed || pending === null) {
      inFlight = false;
      settleWaiters();
      return;
    }
    const body: ProgressBody = { progress_seq: ++seq, ...pending };
    pending = null;
    try {
      await deps.send(body);
      attempt = 0;
    } catch (error) {
      if (isPermanentSaveError(error)) {
        if (error instanceof ApiError && error.code === 'session_closed') deps.onClosed?.();
      } else if (!disposed && !(retired && attempt + 1 >= RETIRED_SEND_ATTEMPTS)) {
        // 다시 시도 — 그사이 새 위치가 들어왔으면 그것이 이긴다.
        if (pending === null) pending = stripSeq(body);
        attempt += 1;
        const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
        timer = setTimeout(() => {
          timer = null;
          void drain();
        }, delay);
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
      if (disposed || retired) return;
      pending = { ...(pending ?? {}), ...payload };
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      void drain();
    },
    /** 밀린 저장이 다 나갈 때까지(버린 뒤라면 보내던 요청이 끝날 때까지). 테스트와 나가기가 기다린다. */
    flushed(): Promise<void> {
      if (pending === null && !inFlight) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** 지금까지 쓴 순번. 같은 회차의 다음 큐가 이보다 큰 순번부터 보낸다. */
    seq(): number {
      return seq;
    },
    /** 새 저장은 받지 않고 남은 것만 보낸다. 끊긴 채면 모두 RETIRED_SEND_ATTEMPTS 번 보내 보고 그만둔다. */
    retire(): void {
      retired = true;
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

/**
 * 회차마다 큐 하나. 끊긴 채 끝낸 회차는 화면을 떠나도 완료 저장을 다시 보내는데(closeProgressQueue keepSending), 그 회차를
 * 다시 열면 남은 완료 저장은 버린다 — 서버가 아직 진행 중이라 이어서 연습하는 쪽이 배우의 마지막 뜻이다. 새 큐는 앞 큐가
 * 보내던 요청이 끝난 뒤, 앞 큐보다 큰 순번부터 보낸다.
 */
const open = new Map<string, ProgressQueue>();

export function openProgressQueue(sessionId: string, deps: ProgressQueueDependencies): ProgressQueue {
  const previous = open.get(sessionId);
  previous?.dispose();
  const queue = createProgressQueue({
    ...deps,
    initialSeq: Math.max(deps.initialSeq ?? 0, previous?.seq() ?? 0),
    after: previous?.flushed(),
  });
  open.set(sessionId, queue);
  return queue;
}

export function closeProgressQueue(sessionId: string, queue: ProgressQueue, options: { keepSending: boolean }): void {
  if (open.get(sessionId) !== queue) return;
  if (!options.keepSending) {
    queue.dispose();
    open.delete(sessionId);
    return;
  }
  queue.retire();
  void queue.flushed().then(() => {
    if (open.get(sessionId) === queue) open.delete(sessionId);
  });
}
