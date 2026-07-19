"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "../../lib/auth/token-store";
import { uploadVideo } from "../../lib/api/v2/uploads";
import {
  createPracticeSession,
  pollSessionUntilSettled,
} from "../../lib/api/v2/sessions";
import { startCoach, replyCoach } from "../../lib/api/v2/coach";
import { createReport } from "../../lib/api/v2/reports";
import type { ActingReport, CoachTurnResponse } from "../../lib/api/v2/types";

type Phase = "input" | "analyzing" | "coaching" | "done";
type ChatMsg = { role: "ai" | "me"; text: string; obs?: string };

const ANALYZE_LABELS = [
  "장면을 분석하고 있어요…",
  "무엇을 물어볼지 고르는 중…",
  "거의 다 됐어요 (서버 처리 30~120초)",
];

const TOUR = [
  { key: "picker", title: "1 · 영상 올리기", body: "여기를 눌러 오늘 연습할 장면 영상을 올려요. (MP4·MOV, 5분 이내)" },
  { key: "inputs", title: "2 · 장면 맥락 적기", body: "상황 · 인물 · 겉으로 드러낸 태도와 속마음을 짧게 적어요. 질문이 이걸 근거로 만들어져요." },
  { key: "begin", title: "3 · 질문 받기", body: "영상을 올리면 이 버튼이 켜져요. 누르면 오른쪽에서 질문이 하나씩 도착해요." },
  { key: "chat", title: "4 · 대화하기", body: "도착한 질문에 여기서 답해요. 정답은 없어요 — 떠오르는 대로 답하면 질문이 이어지고, 답이 쌓이면 마지막에 연습 노트로 정리돼요." },
] as const;

export function PracticeSingle() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login?next=/practice/new");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 인증 확인 후 1회 게이트
    setReady(true);
  }, [router]);

  const [sessionName, setSessionName] = useState("연습1");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const durationMsRef = useRef<number | undefined>(undefined);

  const [situation, setSituation] = useState("");
  const [character, setCharacter] = useState("");
  const [subtext, setSubtext] = useState("");

  const [phase, setPhase] = useState<Phase>("input");
  const [pct, setPct] = useState(0);
  const [analyzeLabel, setAnalyzeLabel] = useState(ANALYZE_LABELS[0]);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState<ActingReport | null>(null);
  const [reportCount, setReportCount] = useState(1);
  const [reportBusy, setReportBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const pctTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guided tour refs (real elements the tour points at)
  const pickerRef = useRef<HTMLElement | null>(null);
  const inputsRef = useRef<HTMLElement | null>(null);
  const beginRef = useRef<HTMLButtonElement | null>(null);
  const chatRef = useRef<HTMLElement | null>(null);
  const [tourStep, setTourStep] = useState(-1); // -1 = off, 0.. = 표시 중
  // 가이드 투어는 첫 연습 때 한 번만. (플래그 기록은 '종료 시'에만 — StrictMode 이중 마운트가 미리 소모하지 않도록)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 localStorage 확인
      if (!localStorage.getItem("acttub_tour_seen")) setTourStep(0);
    } catch {
      /* localStorage 불가 환경은 투어 생략 */
    }
  }, []);
  const [placement, setPlacement] = useState<{
    ring: { left: number; top: number; width: number; height: number };
    pop: { left: number; top: number };
  } | null>(null);

  const positionTour = useCallback(() => {
    if (tourStep < 0) return;
    const map: Record<string, HTMLElement | null> = {
      picker: pickerRef.current,
      inputs: inputsRef.current,
      begin: beginRef.current,
      chat: chatRef.current,
    };
    const el = map[TOUR[tourStep].key];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const popW = 280;
    const left = Math.min(Math.max(12, r.left), window.innerWidth - popW - 12);
    let top = r.bottom + 12;
    if (top + 190 > window.innerHeight - 12) top = Math.max(12, r.top - 190 - 12);
    setPlacement({
      ring: { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 },
      pop: { left, top },
    });
  }, [tourStep]);

  useEffect(() => {
    if (tourStep < 0) return;
    // 페인트 후 레이아웃이 확정된 뒤 측정 (hydration 직후 rect가 0으로 잡히는 것 방지)
    const id = requestAnimationFrame(() => positionTour());
    const onResize = () => positionTour();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, [tourStep, positionTour]);

  const markTourSeen = () => {
    try {
      localStorage.setItem("acttub_tour_seen", "1");
    } catch {
      /* noop */
    }
  };
  const advanceTour = () =>
    setTourStep((s) => {
      if (s < TOUR.length - 1) return s + 1;
      markTourSeen();
      return -1;
    });
  const endTour = () => {
    markTourSeen();
    setTourStep(-1);
  };

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => {
    if (pctTimer.current) clearInterval(pctTimer.current);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const locked = phase === "analyzing" || phase === "coaching" || phase === "done";

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setError(null);
  };

  const startProgress = () => {
    setPct(0);
    setAnalyzeLabel(ANALYZE_LABELS[0]);
    if (pctTimer.current) clearInterval(pctTimer.current);
    pctTimer.current = setInterval(() => {
      setPct((p) => {
        const next = Math.min(95, p + Math.max(0.5, (95 - p) * 0.04));
        setAnalyzeLabel(next < 45 ? ANALYZE_LABELS[0] : next < 80 ? ANALYZE_LABELS[1] : ANALYZE_LABELS[2]);
        return next;
      });
    }, 400);
  };
  const stopProgress = () => {
    if (pctTimer.current) clearInterval(pctTimer.current);
    pctTimer.current = null;
    setPct(100);
  };

  const pushAi = (turn: CoachTurnResponse) => {
    // 코치 세션 id는 매 응답마다 회전할 수 있어 다음 reply/report에 최신 값을 쓴다
    sessionIdRef.current = turn.session_id;
    const obs = turn.focus_timestamp ? `관찰 시점 · ${turn.focus_timestamp}` : undefined;
    setMessages((m) => [...m, { role: "ai", text: turn.utterance, obs }]);
    if (turn.done) setPhase("done");
  };

  const onBegin = useCallback(async () => {
    if (!videoFile) return;
    setTourStep(-1); // 진행 시작하면 가이드 투어 닫기 (stable setter)
    setError(null);
    setPhase("analyzing");
    startProgress();
    try {
      const { intentId } = await uploadVideo(videoFile, { durationMs: durationMsRef.current });
      const { session } = await createPracticeSession({
        upload_intent_id: intentId,
        situation,
        character_context: character,
        subtext,
      });
      const detail = await pollSessionUntilSettled(session.session_id, { intervalMs: 4000 });
      if (detail.status === "failed") throw new Error("영상 분석에 실패했어요. 다른 영상으로 다시 시도해 주세요.");
      const summaryId = detail.summary?.summary_id;
      if (!summaryId) throw new Error("분석 요약을 불러오지 못했어요.");
      const { data: start } = await startCoach({ summary_id: summaryId });
      stopProgress();
      setPhase("coaching");
      pushAi(start);
    } catch (err) {
      if (pctTimer.current) clearInterval(pctTimer.current);
      setPhase("input");
      setError(err instanceof Error ? err.message : "문제가 생겼어요. 다시 시도해 주세요.");
    }
  }, [videoFile, situation, character, subtext]);

  const onSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sending || !sessionIdRef.current) return;
    setMessages((m) => [...m, { role: "me", text }]);
    setChatInput("");
    setSending(true);
    try {
      const { data: turn } = await replyCoach({ session_id: sessionIdRef.current, text });
      pushAi(turn);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "(연결이 잠시 끊겼어요. 다시 답해 주세요.)" }]);
    } finally {
      setSending(false);
    }
  }, [chatInput, sending]);

  const onOpenReport = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setReportBusy(true);
    setReportOpen(true);
    try {
      const { data } = await createReport({ session_id: sessionIdRef.current });
      setReport(data.report);
      setReportCount(data.report_count);
    } catch {
      setError("연습 노트를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
      setReportOpen(false);
    } finally {
      setReportBusy(false);
    }
  }, []);

  if (!ready) return <div className="min-h-dvh bg-white" aria-busy="true" />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white text-[#191f28]">
      {/* Topbar */}
      <header className="flex h-15 shrink-0 items-center gap-3 border-b border-[#edf0f3] bg-white/90 px-5 backdrop-blur">
        <Link href="/home" className="text-lg font-black tracking-[-0.04em]">Acttub</Link>
        <span className="text-[#d1d6db]">·</span>
        <input
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          disabled={locked}
          maxLength={30}
          spellCheck={false}
          className="min-w-0 max-w-[220px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[15px] font-black tracking-[-0.03em] outline-none transition hover:bg-[#f8fbff] focus:border-[#3182f6] focus:bg-white focus:ring-2 focus:ring-[#e8f3ff] disabled:hover:bg-transparent"
        />
        <Link href="/home" className="ml-auto rounded-full bg-[#f8fbff] px-3.5 py-1.5 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6]">홈</Link>
      </header>

      {/* Workspace */}
      <div className="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1.7fr_1fr]">
        {/* Left column */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto lg:overflow-hidden">
          {/* Video */}
          <section ref={pickerRef} className="rounded-3xl bg-white p-4 shadow-[0_16px_45px_rgba(25,31,40,0.06)]">
            {videoUrl ? (
              <>
                <div className="flex aspect-video max-h-[34vh] items-center justify-center overflow-hidden rounded-2xl bg-black">
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration;
                      if (Number.isFinite(d)) durationMsRef.current = Math.round(d * 1000);
                    }}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <button type="button" disabled={locked} onClick={() => fileInputRef.current?.click()} className="rounded-full bg-[#e8f3ff] px-3.5 py-1.5 text-xs font-black text-[#3182f6] transition hover:bg-[#dbeafe] disabled:opacity-50">← 영상 다시 선택</button>
                  <span className="text-xs font-semibold text-[#8b95a1]">이 장면으로 질문을 받아요</span>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex aspect-video max-h-[34vh] w-full flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#cfe0f5] bg-[#f8fbff] px-4 text-center text-[#8b95a1] transition hover:border-[#3182f6] hover:bg-[#e8f3ff] hover:text-[#3182f6]">
                <span className="text-3xl font-black text-[#3182f6]">＋</span>
                <span className="text-sm font-black tracking-[-0.02em] text-[#333d4b]">오늘의 연기 영상을 올려 주세요</span>
                <span className="text-xs font-semibold">MP4 · MOV · 5분 이내 · 끌어다 놓아도 돼요</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
          </section>

          {/* Inputs */}
          <section ref={inputsRef} className="rounded-3xl bg-white p-5 shadow-[0_16px_45px_rgba(25,31,40,0.06)]">
            <h3 className="mb-3.5 text-base font-black tracking-[-0.03em]">이 장면에서 무엇을 연기했는지 알려 주세요</h3>
            <div className={`grid gap-2.5 sm:grid-cols-2 ${locked ? "opacity-55" : ""}`}>
              <Field label="상황" value={situation} onChange={setSituation} disabled={locked} placeholder="예: 이별을 통보받은 직후, 카페에서" />
              <Field label="인물" value={character} onChange={setCharacter} disabled={locked} placeholder="예: 담담한 척하는 20대 후반 여성" />
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-black text-[#333d4b]">겉으로 드러낸 태도와 속마음</label>
                <textarea value={subtext} onChange={(e) => setSubtext(e.target.value)} disabled={locked} placeholder="예: 겉으론 괜찮은 척했지만, 사실은 붙잡고 싶었어요" className="h-12 w-full resize-none rounded-2xl border border-[#e5e8eb] bg-[#f8fbff] px-3 py-2.5 text-sm font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff]" />
              </div>
            </div>

            {phase === "analyzing" ? (
              <div className="mt-4 rounded-2xl bg-[#e8f3ff] px-4 py-3.5">
                <div className="mb-2 flex items-baseline gap-2.5">
                  <span className="text-2xl font-black tracking-[-0.04em] text-[#3182f6] tabular-nums">{Math.round(pct)}%</span>
                  <span className="text-xs font-semibold text-[#4e5968]">{analyzeLabel}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-[#3182f6] transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
                <p className="mt-2 text-[11px] font-semibold text-[#8b95a1]">분석 중에도 왼쪽에서 영상을 볼 수 있어요. 입력은 잠시 잠겨요.</p>
              </div>
            ) : null}

            {error ? <p role="alert" className="mt-4 rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]">{error}</p> : null}

            <div className="mt-4 flex items-center gap-3">
              <button ref={beginRef} type="button" onClick={onBegin} disabled={!videoFile || locked} className="h-11 rounded-2xl bg-[#3182f6] px-6 text-sm font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none">질문 받기</button>
              <span className="text-xs font-semibold text-[#8b95a1]">{phase !== "input" ? "질문이 진행 중이에요" : videoFile ? "준비됐어요 — 눌러서 질문을 받아요" : "영상을 올리면 시작할 수 있어요"}</span>
            </div>
          </section>
        </div>

        {/* Chat column */}
        <section ref={chatRef} className="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-[0_16px_45px_rgba(25,31,40,0.06)]">
          <div className="flex items-center gap-2 border-b border-[#edf0f3] px-4 py-3.5 text-[13px] font-black text-[#4e5968]">
            <span className={`h-1.5 w-1.5 rounded-full ${phase === "coaching" || phase === "done" ? "bg-[#03b26c]" : "bg-[#b0b8c1]"}`} />
            {phase === "input" || phase === "analyzing" ? "아직 질문이 시작되지 않았어요" : "현재 장면을 바탕으로 질문하고 있어요"}
          </div>

          <div ref={chatScrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="m-auto max-w-xs text-center text-[13px] font-semibold leading-6 text-[#8b95a1]">왼쪽에 영상과 장면 맥락을 채우고<br />‘질문 받기’를 누르면 여기서 대화가 시작돼요.</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`max-w-[82%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2.5 text-[13.5px] font-semibold leading-6 ${m.role === "ai" ? "self-start rounded-bl-[5px] bg-[#f8fbff] text-[#191f28]" : "self-end rounded-br-[5px] bg-[#3182f6] text-white"}`}>
                  {m.obs ? <span className="mb-1 block text-[11.5px] font-bold text-[#8b95a1]">{m.obs}</span> : null}
                  {m.text}
                </div>
              ))
            )}
          </div>

          {phase === "done" ? (
            <div className="border-t border-[#edf0f3] p-3">
              <button type="button" onClick={onOpenReport} className="h-11 w-full rounded-2xl bg-[#3182f6] text-sm font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da]">대화를 바탕으로 연습 노트 보기</button>
            </div>
          ) : phase === "coaching" ? (
            <div className="flex gap-2 border-t border-[#edf0f3] p-3">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(); } }} rows={1} placeholder="답을 편하게 적어 주세요" className="h-11 flex-1 resize-none rounded-2xl border border-[#e5e8eb] bg-[#f8fbff] px-3.5 py-2.5 text-[13.5px] font-semibold outline-none focus:border-[#3182f6] focus:bg-white" />
              <button type="button" onClick={() => void onSend()} disabled={sending || !chatInput.trim()} className="w-11 shrink-0 rounded-2xl bg-[#3182f6] text-lg font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]">↑</button>
            </div>
          ) : null}
        </section>
      </div>

      {/* Guided tour (첫 연습 1회, 실제 요소를 하나씩 짚어줌) */}
      {tourStep >= 0 && placement ? (
        <div className="fixed inset-0 z-[60]" onClick={(e) => { if (!(e.target as HTMLElement).closest("[data-tour-pop]")) advanceTour(); }}>
          <div
            className="pointer-events-none fixed rounded-[14px] border-2 border-[#3182f6] transition-all duration-200"
            style={{ left: placement.ring.left, top: placement.ring.top, width: placement.ring.width, height: placement.ring.height, boxShadow: "0 0 0 9999px rgba(15,20,30,0.55)" }}
          />
          <div data-tour-pop className="fixed w-[280px] max-w-[calc(100vw-24px)] rounded-[18px] bg-white p-4 shadow-[0_24px_70px_rgba(25,31,40,0.25)]" style={{ left: placement.pop.left, top: placement.pop.top }}>
            <div className="text-[11px] font-black text-[#3182f6]">{tourStep + 1} / {TOUR.length}</div>
            <div className="mb-1.5 mt-1 text-base font-black tracking-[-0.03em]">{TOUR[tourStep].title}</div>
            <div className="text-[13px] font-semibold leading-6 text-[#4e5968]">{TOUR[tourStep].body}</div>
            <div className="mt-3.5 flex items-center justify-between">
              <button type="button" onClick={endTour} className="p-1.5 text-xs font-bold text-[#8b95a1]">건너뛰기</button>
              <button type="button" onClick={advanceTour} className="rounded-full bg-[#3182f6] px-4 py-2 text-[13px] font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da]">{tourStep === TOUR.length - 1 ? "가이드 끝" : "다음"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Report popup (연습 노트) */}
      {reportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f141e]/45 p-6 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_24px_70px_rgba(25,31,40,0.25)]">
            <div className="flex items-start justify-between px-6 pb-3 pt-6">
              <div>
                <span className="text-xs font-black text-[#3182f6]">{reportCount}번째 연습 노트</span>
                <h2 className="mt-1.5 text-xl font-black tracking-[-0.04em]">{report?.headline ?? (reportBusy ? "연습 노트를 정리하는 중…" : "연습 노트")}</h2>
              </div>
              <button type="button" onClick={() => setReportOpen(false)} className="text-2xl leading-none text-[#8b95a1]">✕</button>
            </div>
            <div className="grid gap-3 overflow-y-auto px-6 pb-6">
              {reportBusy && !report ? (
                <p className="rounded-2xl bg-[#f8fbff] px-4 py-8 text-center text-sm font-semibold text-[#8b95a1]">대화를 정리하고 있어요…</p>
              ) : report ? (
                <>
                  <article className="rounded-3xl border border-[#dce9ff] bg-[#f7faff] p-5">
                    <p className="text-xs font-black text-[#3182f6]">다시 본 순간</p>
                    <h3 className="mt-1.5 text-base font-black tracking-[-0.02em]">영상에서 눈에 남은 곳</h3>
                    <p className="mt-2 inline-flex rounded-full bg-white px-3 py-1.5 text-sm font-black text-[#4e5968]">{report.biggest_problem.start} – {report.biggest_problem.end} · {report.biggest_problem.dimension}</p>
                    <p className="mt-3 whitespace-pre-wrap text-[13px] font-semibold leading-6 text-[#333d4b]">{report.biggest_problem.description}</p>
                  </article>
                  <ReportCard eyebrow="대화에서 확인한 것" title="영상과 답변에서" body={report.evidence} />
                  <ReportCard eyebrow="배우가 스스로 남긴 문장" title="대화에서 붙잡은 말" body={report.self_discovery} />
                  <ReportCard eyebrow="다음 테이크" title="배우가 고른 한 문장" body={report.next_step} tone="blue" />
                </>
              ) : null}
            </div>
            <div className="flex gap-2.5 border-t border-[#edf0f3] px-6 py-4">
              <button type="button" onClick={() => setReportOpen(false)} className="h-11 flex-1 rounded-2xl bg-[#f8fbff] text-sm font-black text-[#4e5968] transition hover:bg-[#eef2f6]">뒤 화면 보기</button>
              <Link href="/home" className="flex h-11 flex-1 items-center justify-center rounded-2xl bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da]">연습 마치기</Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-black text-[#333d4b]">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className="w-full rounded-2xl border border-[#e5e8eb] bg-[#f8fbff] px-3 py-2.5 text-sm font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff]" />
    </div>
  );
}

function ReportCard({ eyebrow, title, body, tone = "gray" }: { eyebrow: string; title: string; body: string; tone?: "gray" | "blue" }) {
  return (
    <article className={`rounded-3xl border p-5 ${tone === "blue" ? "border-[#dce9ff] bg-[#f7faff]" : "border-[#e5e8eb] bg-white"}`}>
      <p className="text-xs font-black text-[#3182f6]">{eyebrow}</p>
      <h3 className="mt-1.5 text-base font-black tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-[13px] font-semibold leading-6 text-[#4e5968]">{body}</p>
    </article>
  );
}
