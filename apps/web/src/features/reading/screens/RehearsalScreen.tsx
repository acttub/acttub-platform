"use client";

/**
 * 읽어주기(D18, reading.session). 상대 대사는 기기가 읽고 내 대사에서 멈춰 기다린다. 진행 "K / N · mm:ss",
 * 가리기 토글과 원문 보기, STT 가 있으면 "방금 말한 것"(흐름에는 끼어들지 않고 대조 결과만 줄 결과에 남김),
 * 60초 무발화 안내(자동 넘김 없음), 나가기 확인, 목소리 준비 실패 → 글로 보기.
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
import {
  ExitConfirm,
  GuideCard,
  MASKED_TEXT,
  MaskToggle,
  maskedLines,
  NoSpeechNote,
  PastLine,
  progressLabel,
  RunHeader,
  useGuide,
  useVoiceReady,
  VoiceFailedNote,
  VoiceGate,
} from "@/features/reading/screens/run-shared";
import { Button, RoleName, StatusPill } from "@/features/reading/ui";

export function RehearsalScreen({
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
    { myTurn: session.advance, partnerVoice: voice.partnerVoice, styleFor: run.styleFor },
  );
  const { state, volume, micError, myTurn } = runner;
  const w = rehearsalWindow(state);
  const prog = progress(state);
  const [guide, dismissGuide] = useGuide();
  const [revealed, reveal] = useRevealed(state.index);
  // record 켬 회차는 내 차례마다 한 줄을 녹음해 올린다. 상대 재생·일시정지 중에는 꺼진다.
  const rec = useLineRecorder({ script, session, state, enabled: session.record });

  // 줄 전환·일시정지마다 서버에 저장한다.
  useEffect(() => {
    run.track(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state.status !== "done") return;
    void run.sync.finish().then(() => onFinish(run.stats("read", prog.total)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // "방금 말한 것": STT 가 있으면 내 차례에 말한 것을 글자로 보여 주고 원문과 대조해 줄 결과에 남긴다.
  // 흐름에는 끼어들지 않는다 — 넘어가는 것은 침묵 감지나 버튼이다.
  const [said, setSaid] = useState<string | null>(null);
  const recRef = useRef<AutoListening | null>(null);
  const isMe = state.status === "me";
  const listen = useCallback(
    (lineIndex: number) => {
      const line = script.lines[lineIndex];
      const lineId = script.lineIds[lineIndex];
      if (line?.type !== "dialogue") return;
      recRef.current = startAutoRecognition({
        onInterim: (t) => setSaid(t),
        onText: (t) => {
          setSaid(t);
          // 대조는 원문과 말한 것 각각 1,000자까지만. 넘으면 대조하지 않고 기록도 남기지 않는다.
          if (!t.trim() || t.length > MATCH_MAX_CHARS || line.text.length > MATCH_MAX_CHARS) return;
          const passed = compare(t, line.text).pass;
          if (passed) run.sync.results.pass(lineId);
          else run.sync.results.miss(lineId);
          rec.noteTranscript(lineId, t, passed, "stt");
        },
        onError: () => {
          /* 인식 불가·무발화는 기록하지 않는다 */
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [script],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaid(null);
    if (!isMe || !sttAvailable()) return;
    listen(state.index);
    return () => {
      recRef.current?.abort();
      recRef.current = null;
    };
  }, [isMe, state.index, listen]);

  const isAi = state.status === "ai";
  const isPaused = state.status === "paused";
  const idle = state.status === "idle";
  const pastDialogues = w.past.filter((l): l is DialogueLine => l.type === "dialogue").slice(-2);
  const mine = (role: string) => run.myRoles.includes(role);
  const masked = (role: string, index?: number) => isMasked(run.mask, { mine: mine(role), mode: "read", revealed: index === state.index && revealed });

  const leave = () => {
    runner.stop();
    recRef.current?.abort();
    rec.finish();
    run.sync.clock.pause();
    run.sync.save(state);
    onExit();
  };

  const stage = (
    <div className="flex flex-col gap-3 md:gap-3.5 w-full md:max-w-[640px]">
      {pastDialogues.map((l, i) => (
        <PastLine key={`${state.index}-${i}`} line={l} mine={mine(l.role)} masked={masked(l.role)} />
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
            {isAi && !runner.voiceFailed && (
              <span className="flex items-end gap-[3px] h-4" aria-label="읽는 중">
                <i className="bar" /><i className="bar" /><i className="bar" /><i className="bar" />
              </span>
            )}
            {isMe && (myTurn === "silence" || rec.recording) && (
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-blue">
                <span className="pulse-me w-2 h-2 rounded-full bg-blue" /> {rec.recording ? "녹음 중" : "듣고 있어요"}
              </span>
            )}
          </div>
          <p className={`script-text mt-3 text-[23px] md:text-[30px] leading-[1.4] font-extrabold text-ink ${masked(w.current.role, state.index) ? "blur-line" : ""}`}>
            {masked(w.current.role, state.index) ? MASKED_TEXT : w.current.text}
          </p>
          {masked(w.current.role, state.index) && (
            <button type="button" onClick={reveal} className="mt-3 text-[13px] font-extrabold text-blue underline underline-offset-4">
              원문 보기
            </button>
          )}
          {isMe && myTurn === "silence" && (
            <div className="mt-3.5 h-1 rounded-full bg-blue-line overflow-hidden">
              <div className="h-full bg-blue transition-[width] duration-100" style={{ width: `${Math.min(100, volume * 900)}%` }} />
            </div>
          )}
        </div>
      )}
      {isMe && sttAvailable() && (
        <div className="rounded-[14px] bg-gray-bg px-3.5 py-3">
          <p className="text-[11.5px] font-bold text-ink-4">방금 말한 것 · 말소리는 브라우저 음성 서비스로 가요</p>
          <p className="script-text text-[14px] mt-1 min-h-5">{said || <span className="text-ink-5">아직 없어요</span>}</p>
        </div>
      )}
      {w.next && state.status !== "done" && (
        <p className="script-text text-[12px] md:text-[13px] text-ink-5 truncate">
          다음 · <RoleName role={w.next.role} me={mine(w.next.role)} className="opacity-70" /> {masked(w.next.role) ? MASKED_TEXT : w.next.text}
        </p>
      )}
    </div>
  );

  const controls = (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[12.5px] text-ink-4 text-center">
        {idle && (myTurn === "silence" ? "시작하면 마이크 권한을 물어봐요" : "내 차례엔 다음을 눌러요")}
        {isAi && !runner.voiceFailed && "상대가 읽는 중 · 끝나면 내 차례"}
        {isMe && (myTurn === "silence" ? "말이 끝나면 자동으로 넘어가요" : "다 말하면 다음을 눌러요")}
        {isPaused && "일시정지"}
      </p>
      {isAi && runner.voiceFailed && <VoiceFailedNote partnerVoice={voice.partnerVoice} />}
      {isMe && runner.noSpeech && <NoSpeechNote />}
      {micError && <p className="text-[12px] text-red text-center">{micError}</p>}
      {rec.notice && <p className="text-[12px] text-warn text-center">{rec.notice}</p>}
      {idle ? (
        <Button size="lg" className="w-full md:w-[340px]" disabled={runner.preparing || !voice.ready} onClick={() => { run.sync.clock.start(); void runner.start(); }}>
          {runner.preparing || !voice.ready ? "상대 목소리 준비 중…" : run.from !== undefined && run.from > run.range.start ? "이어서 시작" : "시작"}
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
        onExit={() => (idle ? leave() : run.setConfirmExit(true))}
        pill={<StatusPill label="리딩 중" />}
        right={progressLabel(state, run.sync.elapsedMs)}
        progressRatio={prog.total ? prog.done / prog.total : 0}
      >
        {rec.pending > 0 && <span className="text-[11.5px] font-bold text-ink-4">녹음 저장 중 {rec.pending}</span>}
        <MaskToggle scriptId={script.id} mask={run.mask} onChange={run.setMask} />
      </RunHeader>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="hidden md:block w-[380px] shrink-0 bg-gray-bg-2 border-r border-line-soft p-5 overflow-y-auto max-h-[calc(100svh-104px)]">
          <p className="text-[13px] font-black text-ink-3 pb-2.5">대본 · {script.title}</p>
          <ReviewList lines={maskedLines(script.lines, run.myRoles, run.mask, "read", revealed ? state.index : -1)} myRoles={run.myRoles} currentIndex={state.index} />
        </aside>
        <div className="flex-1 flex flex-col justify-end md:justify-center items-center gap-5 px-4 py-4 md:p-10">
          {idle && guide && <GuideCard setup={{ mode: "read", advance: session.advance, record: session.record }} onDismiss={dismissGuide} />}
          {idle && <VoiceGate show={voice.needsSetup} onChange={voice.setVoice} />}
          {stage}
          <div className="w-full md:max-w-[640px] pt-1 md:pt-3">{controls}</div>
        </div>
      </div>
      {run.confirmExit && <ExitConfirm state={state} onStay={() => run.setConfirmExit(false)} onLeave={leave} />}
    </Page>
  );
}
