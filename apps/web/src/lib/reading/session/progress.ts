/**
 * 진행 저장(reading.session)과 흐른 시간.
 *
 * 기기는 줄이 바뀔 때마다(상대 줄 포함), 일시정지·나가기·완료 때 위치·누적 시간·줄 결과를 순번(progress_seq,
 * 1씩 증가)과 함께 보낸다. 서버는 저장된 값보다 큰 순번만 반영하고 아니면 현재 값을 돌려주므로 늦게 온 옛
 * 요청이 최신을 덮지 못한다. 저장이 실패하면(오프라인) 기기는 계속 진행하고 마지막 값을 들고 있다가 다음
 * 저장 때 최신 값을 보낸다 — 실패한 순번은 버린다(서버가 못 받았으니 겹치지 않는다).
 */
import { ApiError } from "@/lib/api/v2/errors";
import type { LineResult, ProgressRequest, ProgressResponse } from "@/lib/reading/api-types";

export interface ProgressSnapshot {
  /** 다음에 할 대사 줄. 완료면 null. */
  currentLineId: string | null;
  /** 누적, 일시정지 제외 */
  elapsedMs: number;
  lineResults: LineResult[];
}

export interface ProgressSync {
  /** 최신 값을 보낸다. 실패해도 던지지 않는다 — 다음 저장이 다시 보낸다. */
  push(snapshot: ProgressSnapshot): Promise<ProgressResponse | null>;
  /** 구간 끝을 지났다. complete=true, 위치는 null. */
  complete(snapshot: Omit<ProgressSnapshot, "currentLineId">): Promise<ProgressResponse | null>;
  /** 보내지 못한 값이 남아 있는가 */
  pending(): boolean;
  /** 서버가 회차가 닫혔다고(409 session_closed) 알렸는가. 그 뒤로는 보내지 않는다. */
  closed(): boolean;
  latest(): ProgressSnapshot | null;
  /** 마지막으로 보낸(또는 보내려 한) 본문. 완료 저장이 실패하면 재시도(completion.ts)에 넘긴다. */
  lastRequest(): ProgressRequest | null;
}

export function createProgressSync(deps: {
  send: (body: ProgressRequest) => Promise<ProgressResponse>;
  /** 이어하기: 서버에 저장된 순번부터 이어 센다 */
  startSeq?: number;
}): ProgressSync {
  let seq = deps.startSeq ?? 0;
  let latest: ProgressSnapshot | null = null;
  let pending = false;
  let closed = false;
  // 한 번에 하나만 보낸다. 겹치면 뒤의 것이 앞의 것을 기다렸다가 최신 값으로 나간다.
  let inFlight: Promise<unknown> = Promise.resolve();

  const toBody = (s: ProgressSnapshot, complete: boolean): ProgressRequest => ({
    progress_seq: ++seq,
    current_line_id: complete ? null : s.currentLineId,
    elapsed_seconds: Math.floor(s.elapsedMs / 1000),
    line_results: s.lineResults,
    ...(complete ? { complete: true } : {}),
  });

  let lastBody: ProgressRequest | null = null;

  const attempt = async (snapshot: ProgressSnapshot, complete: boolean): Promise<ProgressResponse | null> => {
    if (closed) return null;
    const body = toBody(snapshot, complete);
    lastBody = body;
    try {
      const answer = await deps.send(body);
      pending = false;
      return answer;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.code === "session_closed") {
        closed = true;
        pending = false;
        return null;
      }
      pending = true;
      return null;
    }
  };

  const queue = (snapshot: ProgressSnapshot, complete: boolean) => {
    latest = snapshot;
    const run = inFlight.then(() => (latest === snapshot || complete ? attempt(snapshot, complete) : null));
    inFlight = run.catch(() => null);
    return run;
  };

  return {
    push: (snapshot) => queue(snapshot, false),
    complete: (snapshot) => queue({ ...snapshot, currentLineId: null }, true),
    pending: () => pending,
    closed: () => closed,
    latest: () => latest,
    lastRequest: () => lastBody,
  };
}

export interface ElapsedClock {
  start(): void;
  pause(): void;
  resume(): void;
  /** 누적, 일시정지 제외(ms) */
  elapsedMs(): number;
  running(): boolean;
}

/** 일시정지를 뺀 흐른 시간. 이어하기는 서버에 저장된 누적 시간(baseMs)부터 이어 센다. */
export function createElapsedClock(now: () => number = () => Date.now(), baseMs = 0): ElapsedClock {
  let accumulated = baseMs;
  let since: number | null = null;
  return {
    start() {
      if (since === null) since = now();
    },
    pause() {
      if (since === null) return;
      accumulated += now() - since;
      since = null;
    },
    resume() {
      if (since === null) since = now();
    },
    elapsedMs: () => accumulated + (since === null ? 0 : now() - since),
    running: () => since !== null,
  };
}
