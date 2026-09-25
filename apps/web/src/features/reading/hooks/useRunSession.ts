"use client";

/**
 * 실행 화면 둘이 같은 순서로 하는 일 — 회차의 구간·이어하기 위치로 상태 머신을 세우고, 줄 전환·일시정지·
 * 완료마다 서버에 저장하고, 나가기 확인을 다룬다. 화면은 그리는 것과 자기 방식의 조작만 맡는다.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionDetail } from "@/lib/reading/api-types";
import type { RehearsalState } from "@/lib/reading/rehearsal/machine";
import { voicesFor } from "@/lib/reading/session/cast";
import { loadMask, type MaskMode } from "@/lib/reading/session/mask";
import { indexOfLine, partnerLineBefore, rangeIndexes } from "@/lib/reading/session/range";
import type { RunStats, StoredScript } from "@/lib/reading/storage";
import { useSessionSync } from "@/features/reading/hooks/useSessionSync";
import { rolesOf } from "@/features/reading/session-start";

export function useRunSession(script: StoredScript, session: SessionDetail) {
  const myRoles = rolesOf(script, session.my_character_ids);
  const range = rangeIndexes(script, { startLineId: session.start_line_id, endLineId: session.end_line_id });
  // 이어하기: current_line 부터, 그 직전 상대 대사 하나를 먼저 읽는다.
  const currentIndex = indexOfLine(script, session.current_line_id);
  const partnerBefore = currentIndex >= 0 ? partnerLineBefore(script, currentIndex, myRoles, range.start) : -1;
  const from = currentIndex >= 0 ? (partnerBefore >= 0 ? partnerBefore : currentIndex) : undefined;
  const voices = voicesFor(script, session.my_character_ids);
  const fallback = Object.values(voices)[0];
  const styleFor = (role: string) => voices[role] ?? fallback;

  const sync = useSessionSync(script, session);
  const [mask, setMask] = useState<MaskMode>(() => loadMask(script.id));
  const [confirmExit, setConfirmExit] = useState(false);

  const savedIndex = useRef<number | null>(null);
  const savedStatus = useRef<RehearsalState["status"] | null>(null);
  /** 상태가 바뀔 때마다 부른다 — 줄 전환·일시정지·재개를 서버와 시계에 반영한다. */
  const track = (state: RehearsalState) => {
    if (state.status === "idle" || state.status === "done") return;
    if (state.status === "paused" && savedStatus.current !== "paused") sync.clock.pause();
    if (state.status !== "paused" && savedStatus.current === "paused") sync.clock.resume();
    if (state.index !== savedIndex.current || state.status === "paused") sync.save(state);
    savedIndex.current = state.index;
    savedStatus.current = state.status;
  };

  const stats = (mode: SessionDetail["mode"], lineCount: number): RunStats => ({
    mode,
    elapsedMs: sync.clock.elapsedMs(),
    lineCount,
    myCharacterNames: session.my_character_names,
    lineResults: sync.results.list(),
  });

  return { myRoles, range, from, styleFor, sync, mask, setMask, confirmExit, setConfirmExit, track, stats };
}

/** 줄이 바뀌면 사라지는 "원문 보기" — 그 줄만 잠깐 푼다 */
export function useRevealed(lineIndex: number): [boolean, () => void] {
  const [revealed, setRevealed] = useState<number>(-1);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRevealed(-1);
  }, [lineIndex]);
  return [revealed === lineIndex, () => setRevealed(lineIndex)];
}
