"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRehearsalRunner } from "@/features/reading/hooks/useRehearsalRunner";
import { startAutoRecognition, sttAvailable, type AutoListening } from "@/lib/reading/audio/stt";
import { compare } from "@/lib/reading/quiz/match";
import { progress, window as rehearsalWindow } from "@/lib/reading/rehearsal/machine";
import type { DialogueLine } from "@/lib/reading/script/parse";
import type { Setup, StoredScript } from "@/lib/reading/storage";
import { Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { Button, Icon, StatusPill } from "@/features/reading/ui";
import type { RunStats } from "@/features/reading/screens/DoneScreen";
import { PastLine, RunHeader, useElapsed, useStyleFor } from "@/features/reading/screens/RehearsalScreen";

const MAX_MISS = 2; // 같은 줄 2회 미달이면 안내 없이 통과 — 특정 화자만 계속 막히는 것을 구조로 막는다

type Outcome = { kind: "pass" } | { kind: "retry"; said: string } | null;

export function QuizScreen({ script, setup, onFinish, onExit }: { script: StoredScript; setup: Setup; onFinish: (s: RunStats) => void; onExit: () => void }) {
  const styleFor = useStyleFor(script, setup.myRole);
  const runner = useRehearsalRunner({ lines: script.lines, myRole: setup.myRole, start: setup.start, end: setup.end }, { myTurn: "wait", styleFor });
  const { state } = runner;
  const w = rehearsalWindow(state);
  const { startedAt, markStart } = useElapsed(state);

  const [revealed, setRevealed] = useState(-1);
  const [said, setSaid] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [sttNote, setSttNote] = useState<string | null>(null);
  const missRef = useRef(0);
  const recRef = useRef<AutoListening | null>(null);
  const results = useRef<{ attempted: number; passed: number; pending: number }>({ attempted: 0, passed: 0, pending: 0 });

  const myLines = script.lines.filter((l): l is DialogueLine => l.type === "dialogue" && l.role === setup.myRole);
  const myDone = script.lines.slice(setup.start, state.index).filter((l) => l.type === "dialogue" && l.role === setup.myRole).length;
  const prog = progress(state);
  const isMe = state.status === "me";
  const isAi = state.status === "ai";
  const idle = state.status === "idle";

  useEffect(() => {
    if (state.status !== "done") return;
    onFinish({ mode: "quiz", elapsedMs: startedAt ? Date.now() - startedAt : 0, lineCount: myLines.length, quiz: { ...results.current } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // 줄이 바뀌면 맞춰본 결과 상태를 비운다 (인식 텍스트는 어디에도 남기지 않는다)
  const lineKey = state.index;
  useEffect(() => {
    recRef.current?.abort();
    recRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaid("");
    setOutcome(null);
    setTyped("");
    setListening(false);
    setSttNote(null);
    missRef.current = 0;
  }, [lineKey]);


  const [pending, setPending] = useState(0);
  function goNext(passed: boolean | null) {
    if (passed === null) {
      results.current.pending++;
      setPending(results.current.pending);
    } else {
      results.current.attempted++;
      if (passed) results.current.passed++;
    }
    runner.next();
  }

  function submit(text: string) {
    if (!w.current) return;
    setSaid(text);
    const r = compare(text, w.current.text);
    if (r.pass) {
      setOutcome({ kind: "pass" });
      setTimeout(() => goNext(true), 700);
      return;
    }
    missRef.current++;
    if (missRef.current >= MAX_MISS) {
      setOutcome({ kind: "pass" });
      setTimeout(() => goNext(false), 700);
      return;
    }
    setOutcome({ kind: "retry", said: text });
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  /** 내 차례가 되면 알아서 듣는다. 말이 끝나면(침묵 1.8초) 그대로 맞춰본다. */
  const listen = useCallback(() => {
    recRef.current = startAutoRecognition({
      onListening: () => setListening(true),
      // 인식되는 대로 보여 준다. 마이크가 살아 있다는 신호이기도 하다.
      onInterim: (t) => setSaid(t),
      onText: (t) => {
        setListening(false);
        submitRef.current(t);
      },
      onError: (reason) => {
        setListening(false);
        setSttNote(
          reason === "unavailable"
            ? "이 브라우저에선 음성인식이 안 돼요. 입력하기로 진행해요."
            : reason === "denied"
              ? "마이크 권한이 없어요. 입력하기로 진행해요."
              : reason === "no-speech"
                ? "말소리를 못 알아들었어요. 다시 말하거나 입력하기를 써 주세요."
                : "다시 말해 주세요.",
        );
        if (reason === "unavailable" || reason === "denied") setTyping(true);
      },
    });
  }, []);

  // 내 차례 동안만 마이크를 연다. 맞춰본 결과이 끝나거나 줄이 넘어가면 바로 닫는다.
  const myTurnNow = isMe && !outcome && !typing && sttAvailable();
  useEffect(() => {
    if (!myTurnNow) return;
    listen();
    return () => {
      recRef.current?.abort();
      recRef.current = null;
    };
  }, [myTurnNow, lineKey, listen]);


  const stage = (
    <div className="flex flex-col gap-3 md:gap-3.5 w-full md:max-w-[640px]">
      {w.past.filter((l): l is DialogueLine => l.type === "dialogue").slice(-1).map((l, i) => (
        <PastLine key={`${state.index}-${i}`} line={l} myRole={setup.myRole} />
      ))}
      {w.current && !isMe && (
        <div className="rounded-[20px] p-5 md:p-7 border bg-surface border-blue-line">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-black text-partner">{w.current.role}</span>
            {isAi && (
              <span className="flex items-end gap-[3px] h-4">
                <i className="bar" /><i className="bar" /><i className="bar" /><i className="bar" />
              </span>
            )}
          </div>
          <p className="script-text mt-3 text-[22px] md:text-[28px] leading-[1.4] font-extrabold">{w.current.text}</p>
        </div>
      )}
      {w.current && isMe && (
        <>
          <div className={`rounded-[20px] md:rounded-[22px] p-5 md:p-7 border ${outcome?.kind === "pass" ? "bg-green-bg border-green" : "bg-surface border-line"}`}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] md:text-[14px] font-black text-blue">{w.current.role} · 내 대사</span>
              <span className="text-[12px] font-bold text-ink-4">첫 글자 힌트: {w.current.text.replace(/^[(（\[【][^)）\]】]*[)）\]】]\s*/, "").charAt(0)}</span>
            </div>
            <p className={`script-text mt-3.5 text-[22px] md:text-[28px] leading-[1.4] font-extrabold ${revealed === state.index || outcome?.kind === "pass" ? "" : "blur-line"}`}>{w.current.text}</p>
            {revealed !== state.index && outcome?.kind !== "pass" && (
              <button type="button" onClick={() => setRevealed(state.index)} className="mt-3.5 text-[13px] font-extrabold text-blue underline underline-offset-4">
                원문 보기
              </button>
            )}
          </div>
          <div className="rounded-[14px] bg-gray-bg px-3.5 py-3">
            <p className="text-[11.5px] font-bold text-ink-4">
              {listening ? "듣는 중 · 말하는 대로 적혀요" : "이렇게 들었어요"}
            </p>
            {/* 고치지 않고 그대로 보여 준다 — 왜 안 맞았는지는 본인이 봐야 안다 */}
            <p className="script-text text-[15px] md:text-[16px] mt-1 min-h-6">
              {said || (listening ? <span className="text-blue">듣고 있어요…</span> : <span className="text-ink-5">아직 없어요</span>)}
            </p>
            {outcome?.kind === "retry" && (
              <p className="text-[12px] text-red mt-1.5">대본과 달라요. 다시 말해 보세요.</p>
            )}
          </div>
          {typing && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) submit(typed.trim());
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="내 대사 입력"
                autoFocus
                className="script-text flex-1 h-11 rounded-xl bg-surface border border-line px-3 text-[14px] focus:outline-none focus:border-blue"
              />
              <Button type="submit" size="md">확인</Button>
            </form>
          )}
          <p className="text-[11.5px] text-ink-4">내 차례 동안 마이크가 켜져 있어요. 말한 것을 글자로 바꿔 대본과만 맞춰보고 바로 버려요. {sttAvailable() && "말소리는 브라우저 음성 서비스로 가요."}</p>
          {sttNote && <p className="text-[12px] text-red">{sttNote}</p>}
        </>
      )}
    </div>
  );

  const controls = idle ? (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[12.5px] text-ink-4">내 차례엔 대사가 가려지고 마이크가 켜져요. 말하면 알아서 맞춰봐요.</p>
      <Button size="lg" className="w-full md:w-[340px]" disabled={runner.preparing} onClick={() => { markStart(); void runner.start(); }}>
        {runner.preparing ? "상대 목소리 준비 중…" : "시작"}
      </Button>
    </div>
  ) : isMe ? (
    <div className="flex flex-col items-center gap-2.5">
      <div className="flex items-center justify-center gap-3 w-full">
        <Button variant="secondary" className="flex-1 md:w-36 md:flex-none" onClick={() => { setSaid(""); setOutcome(null); setSttNote(null); }}>
          다시
        </Button>
        <button
          type="button"
          onClick={() => recRef.current?.finish()}
          disabled={!listening}
          aria-label="지금 확정"
          title="다 말했으면 눌러서 바로 맞춰봐요"
          className={`w-[68px] h-[68px] rounded-full flex items-center justify-center text-white shadow-[0_8px_20px_rgba(10,121,251,0.25)] select-none touch-none disabled:opacity-40 ${listening ? "bg-blue-dark pulse-me" : "bg-blue"}`}
        >
          <Icon name="mic" size={28} />
        </button>
        <Button className="flex-1 md:w-36 md:flex-none" onClick={() => goNext(null)}>
          넘어가기
        </Button>
      </div>
      <p className="text-[12px] font-bold text-ink-4">
        {listening ? "말이 끝나면 알아서 맞춰봐요 · 다 말했으면 눌러도 돼요" : "말하면 알아서 맞춰봐요"} ·{" "}
        <button type="button" onClick={() => setTyping((v) => !v)} className="text-blue underline underline-offset-2">
          입력하기
        </button>
      </p>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[12.5px] text-ink-4">상대가 읽는 중 · 끝나면 내 차례</p>
      <div className="flex gap-2 w-full md:w-auto">
        <Button variant="secondary" className="flex-1 md:w-40" onClick={runner.togglePause}>
          {state.status === "paused" ? "이어가기" : "일시정지"}
        </Button>
        <Button className="flex-1 md:w-40" onClick={runner.next}>
          다음
        </Button>
      </div>
    </div>
  );

  return (
    <Page wide className="md:bg-surface">
      <RunHeader
        onExit={() => { runner.stop(); recRef.current?.abort(); onExit(); }}
        pill={<StatusPill label="암기 대조" tone="warn" />}
        right={`${myDone} / ${myLines.length} · 아직 안 나온 줄 ${pending}`}
        progressRatio={prog.total ? prog.done / prog.total : 0}
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="hidden md:block w-[380px] shrink-0 bg-gray-bg-2 border-r border-line-soft p-5 overflow-y-auto max-h-[calc(100svh-104px)]">
          <p className="text-[13px] font-black text-ink-3 pb-2.5">대본 · {script.title ?? "대본"}</p>
          <ReviewList lines={script.lines.map((l) => (l.type === "dialogue" && l.role === setup.myRole && l !== script.lines[state.index] && script.lines.indexOf(l) > state.index ? { ...l, text: "· · ·" } : l))} myRole={setup.myRole} currentIndex={state.index} />
        </aside>
        <div className="flex-1 flex flex-col justify-end md:justify-center items-center gap-5 px-4 py-4 md:p-10">
          {stage}
          <div className="w-full md:max-w-[640px] pt-1 md:pt-3">{controls}</div>
        </div>
      </div>
    </Page>
  );
}
