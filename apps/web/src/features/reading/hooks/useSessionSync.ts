"use client";

/**
 * 실행 화면이 서버 회차와 맞물리는 자리(reading.session). 줄이 바뀔 때마다(상대 줄 포함), 일시정지·나가기·
 * 완료 때 위치·누적 시간(일시정지 제외)·줄 결과를 순번과 함께 보낸다. 실패해도 흐름은 멈추지 않고
 * 다음 저장이 최신 값을 보낸다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { saveProgress } from "@/lib/api/v2/reading-sessions";
import type { SessionDetail } from "@/lib/reading/api-types";
import type { RehearsalState } from "@/lib/reading/rehearsal/machine";
import { createElapsedClock, createProgressSync, type ElapsedClock, type ProgressSync } from "@/lib/reading/session/progress";
import { createLineResults, type LineResults } from "@/lib/reading/session/results";
import type { StoredScript } from "@/lib/reading/storage";

export interface SessionSync {
  clock: ElapsedClock;
  results: LineResults;
  /** 화면 표시용, 1초마다 갱신 */
  elapsedMs: number;
  /** 지금 상태를 저장한다(줄 전환·일시정지·나가기). */
  save: (state: RehearsalState) => void;
  /** 구간 끝을 지났다. 서버에 complete 를 보내고 완료 응답을 기다린다. */
  finish: () => Promise<void>;
  /** 서버가 회차가 닫혔다고 알렸다(409). */
  closed: boolean;
}

export function useSessionSync(script: StoredScript, session: SessionDetail): SessionSync {
  // 시계는 렌더 밖에서만 시각을 읽는다(start·pause·elapsedMs). 기본 인자가 Date.now 를 쓴다.
  const clock = useMemo(() => createElapsedClock(undefined, session.elapsed_seconds * 1000), [session.elapsed_seconds]);
  const results = useMemo(() => createLineResults(session.line_results), [session.line_results]);
  const sync: ProgressSync = useMemo(
    () => createProgressSync({ send: (body) => saveProgress(session.id, body), startSeq: session.progress_seq }),
    [session.id, session.progress_seq],
  );
  const [elapsedMs, setElapsedMs] = useState(session.elapsed_seconds * 1000);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsedMs(clock.elapsedMs()), 1000);
    return () => clearInterval(t);
  }, [clock]);

  const lastSavedIndex = useRef<number | null>(null);

  const save = (state: RehearsalState) => {
    if (state.status === "idle" || state.status === "done") return;
    lastSavedIndex.current = state.index;
    void sync
      .push({ currentLineId: script.lineIds[state.index] ?? null, elapsedMs: clock.elapsedMs(), lineResults: results.list() })
      .then(() => {
        if (sync.closed()) setClosed(true);
      });
  };

  const finish = async () => {
    clock.pause();
    await sync.complete({ elapsedMs: clock.elapsedMs(), lineResults: results.list() });
    if (sync.closed()) setClosed(true);
  };

  return { clock, results, elapsedMs, save, finish, closed };
}
