"use client";

/**
 * 암기 대조(D18 quiz, reading.session·reading.memorization). 내 대사는 가려지고(일반 가리기보다 우선) 말한
 * 것을 기기 STT 로 원문과 대조한다. 미달이면 "다시"와 "넘어가기"를 주고 같은 줄에 머문다. 같은 줄 2회 미달이면
 * 안내 없이 넘어간다(unmatched). 넘어가기는 skipped. STT 가 없거나 막히면 "입력하기"로 글자를 쳐서 대조한다.
 * 맞음·틀림을 내지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLineRecorder } from "@/features/reading/hooks/useLineRecorder";
import { useRehearsalRunner, type PartnerVoice } from "@/features/reading/hooks/useRehearsalRunner";
import { useRevealed, useRunSession } from "@/features/reading/hooks/useRunSession";
import { startAutoRecognition, sttAvailable, type AutoListening } from "@/lib/reading/audio/stt";
import { compare, MATCH_MAX_CHARS } from "@/lib/reading/quiz/match";
import { progress, window as rehearsalWindow } from "@/lib/reading/rehearsal/machine";
import type { DialogueLine } from "@/lib/reading/script/parse";
import type { SessionDetail } from "@/lib/reading/api-types";
import { isMasked } from "@/lib/reading/session/mask";
import type { RunStats, StoredScript } from "@/lib/reading/storage";
import { Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { NO_SPEECH_NOTICE } from "@/features/reading/session-copy";
import {
  ExitConfirm,
  GuideCard,
  MASKED_TEXT,
  MaskToggle,
  maskedLines,
  PastLine,
  progressLabel,
  RunHeader,
  useGuide,
  useVoiceReady,
  VoiceFailedNote,
  VoiceGate,
} from "@/features/reading/screens/run-shared";
import { Button, Icon, StatusPill } from "@/features/reading/ui";

/** 같은 줄 2회 미달이면 안내 없이 넘어간다 — 특정 화자만 계속 막히는 것을 구조로 막는다 */
const MAX_MISS = 2;

type Outcome = { kind: "pass" } | { kind: "retry"; said: string } | null;

export function QuizScreen({
  script,
  session,
  partnerVoice: initialVoice,
  onFinish,
  onExit,
}: {
  script: StoredScript;
  session: SessionDetail;
  partnerVoice: PartnerVoice;
  onFinish: (s: RunStats) => void;
  onExit: () => void;
}) {
  const run = useRunSession(script, session);
  const hasPartners = script.lines.some((l, i) => l.type === "dialogue" && !run.myRoles.includes(l.role) && i >= run.range.start && i <= run.range.end);
  const voice = useVoiceReady(initialVoice, hasPartners);
  const runner = useRehearsalRunner(
    { lines: script.lines, myRoles: run.myRoles, start: run.range.start, end: run.range.end, from: run.from },
    { myTurn: "wait", partnerVoice: voice.partnerVoice, styleFor: run.styleFor },
  );
  const { state } = runner;
  const w = rehearsalWindow(state);
  const prog = progress(state);
  const [guide, dismissGuide] = useGuide();
  const [revealed, reveal] = useRevealed(state.index);
  // record 켬 회차는 내 차례마다 녹음해 올린다. 입력하기로 대조한 줄은 녹음 행을 만들지 않는다.
  const rec = useLineRecorder({ script, session, state, enabled: session.record });

  const [said, setSaid] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [sttNote, setSttNote] = useState<string | null>(null);
  const recRef = useRef<AutoListening | null>(null);

  const mine = (role: string) => run.myRoles.includes(role);
  const isMe = state.status === "me";
  const isAi = state.status === "ai";
  const idle = state.status === "idle";
  const lineId = script.lineIds[state.index];

  useEffect(() => {
    run.track(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state.status !== "done") return;
    void run.sync.finish().then(() => onFinish(run.stats("quiz", prog.total)));
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
  }, [lineKey]);

  function goNext() {
    runner.next();
  }

  /** 발화를 확정해 대조한다. 통과·2회 미달만 다음 줄로 간다. */
  function submit(text: string, source: "stt" | "typed" = "stt") {
    if (!w.current || !lineId) return;
    setSaid(text);
    // 대조는 원문과 말한 것 각각 1,000자까지만. 넘으면 대조하지 않고 수동 진행이며 미달로 기록하지 않는다.
    if (text.length > MATCH_MAX_CHARS || w.current.text.length > MATCH_MAX_CHARS) {
      setSttNote("대사가 길어 대조하지 않아요. 넘어가기로 진행해 주세요.");
      return;
    }
    const r = compare(text, w.current.text);
    rec.noteTranscript(lineId, text, r.pass, source);
    if (r.pass) {
      run.sync.results.pass(lineId);
      setOutcome({ kind: "pass" });
      setTimeout(goNext, 700);
      return;
    }
    const misses = run.sync.results.miss(lineId);
    if (misses >= MAX_MISS) {
      // 안내 없이 넘어간다. 결과는 unmatched 로 남는다.
      setTimeout(goNext, 300);
      return;
    }
    setOutcome({ kind: "retry", said: text });
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  /** 내 차례가 되면 알아서 듣는다. 말이 끝나면(침묵 1.8초) 그대로 맞춰본다. 60초 무발화면 안내만 한다. */
  const listen = useCallback(() => {
    recRef.current = startAutoRecognition({
      onListening: () => setListening(true),
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
                ? NO_SPEECH_NOTICE
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

  const leave = () => {
    runner.stop();
    recRef.current?.abort();
    rec.finish();
    run.sync.clock.pause();
    run.sync.save(state);
    onExit();
  };

  const partnerMasked = (role: string) => isMasked(run.mask, { mine: false, mode: "quiz" }) && !mine(role);
  const skip = () => {
    if (lineId) run.sync.results.skip(lineId);
    goNext();
  };

  const stage = (
    <div className="flex flex-col gap-3 md:gap-3.5 w-full md:max-w-[640px]">
      {w.past.filter((l): l is DialogueLine => l.type === "dialogue").slice(-1).map((l, i) => (
        <PastLine key={`${state.index}-${i}`} line={l} mine={mine(l.role)} masked={mine(l.role) || partnerMasked(l.role)} />
      ))}
      {w.current && !isMe && (
        <div className="rounded-[20px] p-5 md:p-7 border bg-surface border-blue-line">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-black text-partner">{w.current.role}</span>
            {isAi && !runner.voiceFailed && (
              <span className="flex items-end gap-[3px] h-4">
                <i className="bar" /><i className="bar" /><i className="bar" /><i className="bar" />
              </span>
            )}
          </div>
          <p className={`script-text mt-3 text-[22px] md:text-[28px] leading-[1.4] font-extrabold ${partnerMasked(w.current.role) && !revealed ? "blur-line" : ""}`}>
            {partnerMasked(w.current.role) && !revealed ? MASKED_TEXT : w.current.text}
          </p>
          {partnerMasked(w.current.role) && !revealed && (
            <button type="button" onClick={reveal} className="mt-3 text-[13px] font-extrabold text-blue underline underline-offset-4">
              원문 보기
            </button>
          )}
        </div>
      )}
      {w.current && isMe && (
        <>
          <div className={`rounded-[20px] md:rounded-[22px] p-5 md:p-7 border ${outcome?.kind === "pass" ? "bg-green-bg border-green" : "bg-surface border-line"}`}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] md:text-[14px] font-black text-blue">{w.current.role} · 내 대사</span>
              <span className="text-[12px] font-bold text-ink-4">첫 글자 힌트: {w.current.text.replace(/^[(（\[【][^)）\]】]*[)）\]】]\s*/, "").charAt(0)}</span>
            </div>
            <p className={`script-text mt-3.5 text-[22px] md:text-[28px] leading-[1.4] font-extrabold ${revealed || outcome?.kind === "pass" ? "" : "blur-line"}`}>
              {revealed || outcome?.kind === "pass" ? w.current.text : MASKED_TEXT}
            </p>
            {!revealed && outcome?.kind !== "pass" && (
              <button type="button" onClick={reveal} className="mt-3.5 text-[13px] font-extrabold text-blue underline underline-offset-4">
                원문 보기
              </button>
            )}
          </div>
          <div className="rounded-[14px] bg-gray-bg px-3.5 py-3">
            <p className="text-[11.5px] font-bold text-ink-4">{listening ? "듣는 중 · 말하는 대로 적혀요" : "이렇게 들었어요"}</p>
            {/* 고치지 않고 그대로 보여 준다 — 왜 안 맞았는지는 본인이 봐야 안다 */}
            <p className="script-text text-[15px] md:text-[16px] mt-1 min-h-6">
              {said || (listening ? <span className="text-blue">듣고 있어요…</span> : <span className="text-ink-5">아직 없어요</span>)}
            </p>
            {outcome?.kind === "retry" && <p className="text-[12px] text-warn mt-1.5">대본과 달라요. 다시 말하거나 넘어갈 수 있어요.</p>}
          </div>
          {typing && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) submit(typed.trim(), "typed");
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
          <p className="text-[11.5px] text-ink-4">
            내 차례 동안 마이크가 켜져 있어요. 말한 것을 글자로 바꿔 대본과 맞춰 봐요. {sttAvailable() && "말소리는 브라우저 음성 서비스로 가요."}
            {rec.recording && " 이 줄은 녹음돼 내 계정에 저장돼요."}
          </p>
          {rec.notice && <p className="text-[12px] text-warn">{rec.notice}</p>}
          {sttNote && <p className="text-[12px] text-ink-3 font-bold">{sttNote}</p>}
        </>
      )}
    </div>
  );

  const controls = idle ? (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[12.5px] text-ink-4">내 차례엔 대사가 가려지고 마이크가 켜져요. 말하면 알아서 맞춰봐요.</p>
      <Button size="lg" className="w-full md:w-[340px]" disabled={runner.preparing || !voice.ready} onClick={() => { run.sync.clock.start(); void runner.start(); }}>
        {runner.preparing || !voice.ready ? "상대 목소리 준비 중…" : "시작"}
      </Button>
    </div>
  ) : isMe ? (
    <div className="flex flex-col items-center gap-2.5">
      <div className="flex items-center justify-center gap-3 w-full">
        <Button variant="secondary" className="flex-1 md:w-36 md:flex-none" onClick={() => { setSaid(""); setOutcome(null); setSttNote(null); rec.restart(); }}>
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
        <Button className="flex-1 md:w-36 md:flex-none" onClick={skip}>
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
      {isAi && runner.voiceFailed ? <VoiceFailedNote partnerVoice={voice.partnerVoice} /> : <p className="text-[12.5px] text-ink-4">상대가 읽는 중 · 끝나면 내 차례</p>}
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
        onExit={() => (idle ? leave() : run.setConfirmExit(true))}
        pill={<StatusPill label="암기 대조" tone="warn" />}
        right={progressLabel(state, run.sync.elapsedMs)}
        progressRatio={prog.total ? prog.done / prog.total : 0}
      >
        {rec.pending > 0 && <span className="text-[11.5px] font-bold text-ink-4">녹음 저장 중 {rec.pending}</span>}
        <MaskToggle scriptId={script.id} mask={run.mask} onChange={run.setMask} />
      </RunHeader>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="hidden md:block w-[380px] shrink-0 bg-gray-bg-2 border-r border-line-soft p-5 overflow-y-auto max-h-[calc(100svh-104px)]">
          <p className="text-[13px] font-black text-ink-3 pb-2.5">대본 · {script.title}</p>
          <ReviewList lines={maskedLines(script.lines, run.myRoles, run.mask, "quiz", revealed ? state.index : -1)} myRoles={run.myRoles} currentIndex={state.index} />
        </aside>
        <div className="flex-1 flex flex-col justify-end md:justify-center items-center gap-5 px-4 py-4 md:p-10">
          {idle && guide && <GuideCard setup={{ mode: "quiz", advance: session.advance, record: session.record }} onDismiss={dismissGuide} />}
          {idle && <VoiceGate show={voice.needsSetup} onChange={voice.setVoice} />}
          {stage}
          <div className="w-full md:max-w-[640px] pt-1 md:pt-3">{controls}</div>
        </div>
      </div>
      {run.confirmExit && <ExitConfirm state={state} onStay={() => run.setConfirmExit(false)} onLeave={leave} />}
    </Page>
  );
}
