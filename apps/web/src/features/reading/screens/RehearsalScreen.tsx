"use client";

import { useEffect, useMemo, useState } from "react";
import { useRehearsalRunner } from "@/features/reading/hooks/useRehearsalRunner";
import { assignVoices } from "@/lib/reading/audio/tts";
import { progress, window as rehearsalWindow, type RehearsalState } from "@/lib/reading/rehearsal/machine";
import type { DialogueLine } from "@/lib/reading/script/parse";
import type { Setup, StoredScript } from "@/lib/reading/storage";
import { fmtClock, Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { Button, Icon, RoleName, StatusPill } from "@/features/reading/ui";
import type { RunStats } from "@/features/reading/screens/DoneScreen";

export function useStyleFor(script: StoredScript, myRole: string) {
  // 내 배역을 뺀 나머지에게 등장 순서대로 목소리를 준다. 같은 대본이면 늘 같은 배정이다.
  const voices = useMemo(
    () => assignVoices(script.roles.filter((r) => r !== myRole)),
    [script.roles, myRole],
  );
  const fallback = useMemo(() => Object.values(voices)[0], [voices]);
  return (role: string) => voices[role] ?? fallback;
}

export function useElapsed(state: RehearsalState) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null || state.status === "done") return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt, state.status]);
  return { elapsed, startedAt, markStart: () => setStartedAt(Date.now()) };
}

/** 리딩·암기 대조 공통 상단: 나가기 · 상태 알약 · 진행 */
export function RunHeader({ onExit, pill, right, progressRatio }: { onExit: () => void; pill: React.ReactNode; right: string; progressRatio: number }) {
  return (
    <div className="bg-surface md:bg-transparent">
      <div className="h-12 md:h-14 flex items-center justify-between px-4 md:px-5 md:border-b md:border-line-soft">
        <button type="button" onClick={onExit} className="flex items-center gap-1 text-[13px] font-bold text-ink-3">
          <Icon name="x" size={16} /> 나가기
        </button>
        {pill}
        <span className="text-[12.5px] font-bold text-ink-4 tabular-nums">{right}</span>
      </div>
      <div className="px-4 md:hidden">
        <div className="h-1 rounded-full bg-line overflow-hidden">
          <div className="h-full bg-blue transition-[width] duration-500" style={{ width: `${progressRatio * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export function PastLine({ line, myRole }: { line: DialogueLine; myRole: string }) {
  return (
    <p className="script-text flex gap-2 text-[13px] md:text-[14px] text-ink-4 leading-relaxed">
      <span className={`shrink-0 font-extrabold ${line.role === myRole ? "text-me-soft" : "text-partner-soft"}`}>{line.role}</span>
      {line.text}
    </p>
  );
}

export function RehearsalScreen({ script, setup, onFinish, onExit }: { script: StoredScript; setup: Setup; onFinish: (s: RunStats) => void; onExit: () => void }) {
  const styleFor = useStyleFor(script, setup.myRole);
  const runner = useRehearsalRunner(
    { lines: script.lines, myRole: setup.myRole, start: setup.start, end: setup.end },
    { myTurn: setup.advanceMode, styleFor },
  );
  const { state, volume, micError, myTurn } = runner;
  const w = rehearsalWindow(state);
  const prog = progress(state);
  const { elapsed, startedAt, markStart } = useElapsed(state);

  useEffect(() => {
    if (state.status !== "done") return;
    onFinish({ mode: "read", elapsedMs: startedAt ? Date.now() - startedAt : 0, lineCount: prog.total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const isMe = state.status === "me";
  const isAi = state.status === "ai";
  const isPaused = state.status === "paused";
  const idle = state.status === "idle";
  const pastDialogues = w.past.filter((l): l is DialogueLine => l.type === "dialogue").slice(-2);

  const stage = (
    <div className="flex flex-col gap-3 md:gap-3.5 w-full md:max-w-[640px]">
      {pastDialogues.map((l, i) => (
        <PastLine key={`${state.index}-${i}`} line={l} myRole={setup.myRole} />
      ))}
      {w.leadingDirections.map((d, i) => (
        <p key={i} className="script-text text-[12.5px] md:text-[13px] italic text-ink-4">
          {d}
        </p>
      ))}
      {w.current && (
        <div
          className={`rounded-[20px] md:rounded-[22px] p-5 md:p-7 border shadow-[0_8px_24px_rgba(10,121,251,0.08)] ${
            isMe ? "bg-blue-mist border-blue border-[1.5px]" : isPaused ? "bg-surface border-line" : "bg-surface border-blue-line"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[13px] md:text-[14px] font-black ${isMe ? "text-blue" : "text-partner"}`}>
              {isMe ? `${w.current.role} · 내 차례` : w.current.role}
            </span>
            {isAi && (
              <span className="flex items-end gap-[3px] h-4" aria-label="읽는 중">
                <i className="bar" /><i className="bar" /><i className="bar" /><i className="bar" />
              </span>
            )}
            {isMe && myTurn === "silence" && (
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-blue">
                <span className="pulse-me w-2 h-2 rounded-full bg-blue" /> 듣고 있어요
              </span>
            )}
          </div>
          <p className="script-text mt-3 text-[23px] md:text-[30px] leading-[1.4] font-extrabold text-ink">{w.current.text}</p>
          {isMe && myTurn === "silence" && (
            <div className="mt-3.5 h-1 rounded-full bg-blue-line overflow-hidden">
              <div className="h-full bg-blue transition-[width] duration-100" style={{ width: `${Math.min(100, volume * 900)}%` }} />
            </div>
          )}
        </div>
      )}
      {w.next && state.status !== "done" && (
        <p className="script-text text-[12px] md:text-[13px] text-ink-5 truncate">
          다음 · <RoleName role={w.next.role} me={w.next.role === setup.myRole} className="opacity-70" /> {w.next.text}
        </p>
      )}
    </div>
  );

  const controls = (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[12.5px] text-ink-4 text-center">
        {idle && (myTurn === "silence" ? "시작하면 마이크 권한을 물어봐요" : "내 차례엔 다음을 눌러요")}
        {isAi && "상대가 읽는 중 · 끝나면 내 차례"}
        {isMe && (myTurn === "silence" ? "말이 끝나면 자동으로 넘어가요" : "다 말하면 다음을 눌러요")}
        {isPaused && "일시정지"}
      </p>
      {micError && <p className="text-[12px] text-red text-center">{micError}</p>}
      {idle ? (
        <Button size="lg" className="w-full md:w-[340px]" disabled={runner.preparing} onClick={() => { markStart(); void runner.start(); }}>
          {runner.preparing ? "상대 목소리 준비 중…" : "시작"}
        </Button>
      ) : (
        <div className="flex gap-2 w-full md:w-auto">
          <Button variant="secondary" className="flex-1 md:w-40" onClick={runner.togglePause}>
            {isPaused ? "이어가기" : "일시정지"}
          </Button>
          <Button className="flex-1 md:w-40" onClick={runner.next}>
            다음
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Page wide className="md:bg-surface">
      <RunHeader
        onExit={() => { runner.stop(); onExit(); }}
        pill={<StatusPill label="리딩 중" />}
        right={`${prog.done} / ${prog.total} · ${fmtClock(elapsed)}`}
        progressRatio={prog.total ? prog.done / prog.total : 0}
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="hidden md:block w-[380px] shrink-0 bg-gray-bg-2 border-r border-line-soft p-5 overflow-y-auto max-h-[calc(100svh-104px)]">
          <p className="text-[13px] font-black text-ink-3 pb-2.5">대본 · {script.title ?? "대본"}</p>
          <ReviewList lines={script.lines} myRole={setup.myRole} currentIndex={state.index} />
        </aside>
        <div className="flex-1 flex flex-col justify-end md:justify-center items-center gap-5 px-4 py-4 md:p-10">
          {stage}
          <div className="w-full md:max-w-[640px] pt-1 md:pt-3">{controls}</div>
        </div>
      </div>
    </Page>
  );
}
