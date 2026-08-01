"use client";

// 홈 · 새 연습 · 연습 기록 · 세션 상세를 한 화면으로 합친 통합 워크스페이스.
// 왼쪽에 지난 세션 바, 오른쪽을 현재 세션이 채운다.
// 설계 정본은 새 UI 디자인 캔버스(2026-07-27)의 D1~D10 · M1~M9 화면.
//
// 기존 practice-flow.tsx / practice-single.tsx 는 건드리지 않았다. 라우트만 이쪽을 보게 바꿨고,
// 되돌리려면 app/*/page.tsx 의 import 를 원래대로 돌리면 된다.

import Image from "next/image";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import wordmark from "@/assets/acttub-wordmark.png";
import { logout } from "@/lib/api/v2/auth";
import { startCoach, replyCoach } from "@/lib/api/v2/coach";
import { createReport, getReport, listReports } from "@/lib/api/v2/reports";
import {
  createPracticeSession,
  deletePracticeSession,
  getPracticeSession,
  listPracticeSessions,
  pollSessionUntilSettled,
} from "@/lib/api/v2/sessions";
import type {
  ActingReport,
  CoachTurnResponse,
  PracticeSessionDetail,
  PracticeSessionListItem,
  ReportRecord,
} from "@/lib/api/v2/types";
import { getStoredUser, isLoggedIn } from "@/lib/auth/token-store";
import { prepareVideoUpload } from "@/lib/media/upload-preflight";
import { uploadVideo } from "@/lib/api/v2/uploads";
import {
  trackDialogueStarted,
  trackResultViewed,
  trackVideoUploaded,
} from "@/lib/analytics/ga";
import { REVIEW_FORM_URL } from "@/lib/config/env";
import { analysisFailure } from "../practice/analysis-failure";

/** 준비 → 분석 → 대화 → 노트. 화면이 단계마다 대화 쪽으로 좁혀진다. */
type Mode = "prep" | "analyzing" | "chat" | "note";
type ChatMsg = { role: "ai" | "me"; text: string; at?: string };

// 서버 분석 상태는 analyzing/analyzed/failed 셋뿐이라 진짜 진행률이 없다.
// 압축·업로드에는 진짜 진행률이 있고, 서버 대기는 실측 평균 시간을 기준으로 채운다.
const ANALYZE_LABEL = "장면을 분석하고 있어요…";
const AVG_ANALYZE_SEC = 60;
const SLOW_NOTICE_SEC = 180;
// 압축·업로드·분석을 진행률 막대 하나로 잇는다. 구간마다 0으로 되돌아가면 배우에게는
// 끝난 작업이 다시 시작되는 것으로 보인다 (2026-07-28).
const COMPRESS_END = 20;
const UPLOAD_END = 45;
// 서버 대기 구간이 닿을 수 있는 최대치. 100%는 실제로 끝났을 때만 쓴다.
const WAIT_CEILING = 92;
const GIVE_UP_MS = 15 * 60_000;

export function WorkspaceApp() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" aria-busy="true" />}>
      <WorkspaceInner />
    </Suspense>
  );
}

function WorkspaceInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");

  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isLoggedIn()) {
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`/login?next=${encodeURIComponent(`/practice/new${search}`)}`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 인증 확인 후 1회 게이트
    setReady(true);
  }, [router]);

  // ── 왼쪽 세션 바 ────────────────────────────────────────────────
  const [sessions, setSessions] = useState<PracticeSessionListItem[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [listError, setListError] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scenePanelOpen, setScenePanelOpen] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([listPracticeSessions(), listReports()]);
      setSessions(s.sessions);
      setReports(r.reports);
      setListError(false);
    } catch {
      setListError(true);
    }
  }, []);

  // 목록은 이펙트 안에서 직접 불러온다. setState 가 await 뒤에서만 일어나야 하고
  // (동기 setState 는 연쇄 렌더를 만든다), 화면을 떠나면 늦게 온 응답을 버려야 한다.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, r] = await Promise.all([listPracticeSessions(), listReports()]);
        if (cancelled) return;
        setSessions(s.sessions);
        setReports(r.reports);
        setListError(false);
      } catch {
        if (!cancelled) setListError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // ── 현재 세션 ───────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("prep");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PracticeSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 준비 단계 입력
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [situation, setSituation] = useState("");
  const [character, setCharacter] = useState("");
  const [goal, setGoal] = useState("");

  // 분석 대기
  const [pct, setPct] = useState(0);
  const [analyzeLabel, setAnalyzeLabel] = useState(ANALYZE_LABEL);
  const [serverWaiting, setServerWaiting] = useState(false);
  const [waitedSec, setWaitedSec] = useState(0);
  const [stalled, setStalled] = useState(false);

  // 대화
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [coachDone, setCoachDone] = useState(false);
  const coachIdRef = useRef<string | null>(null);

  // 연습 노트
  const [report, setReport] = useState<ActingReport | null>(null);
  const [reportCount, setReportCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const waitTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitStartedAt = useRef(0);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gaveUpRef = useRef(false);
  const uploadControllerRef = useRef<AbortController | null>(null);

  // 어느 연습에서 어느 단계를 이미 세었는지. 대화와 노트 확인은 한 연습 안에서 여러 번
  // 열린다 — 노트를 보다 대화로 돌아갔다 오거나, 지난 연습을 다시 열거나.
  // 그대로 두면 단계별 수가 부풀어 어디서 사람이 빠지는지 못 읽는다.
  // 화면을 벗어났다 돌아오면 이 Set 은 비므로 그때는 다시 센다 — 유입경로 그래프는
  // 사람 수로 그려져 영향이 없고, 이걸 막으려면 기기에 기록을 남겨야 해서 두지 않았다.
  const countedStepsRef = useRef<Set<string>>(new Set());
  // 세션 id 는 열쇠로만 쓰고 GA4 로 보내지 않는다. 보내는 값은 ga.ts 가 정하고,
  // 그 파일이 주소에서 식별자를 씻어내는 이유가 여기에도 그대로 적용된다.
  const countStepOnce = useCallback(
    (practiceSessionId: string | null, stepName: "dialogue" | "result") => {
      if (!practiceSessionId) return;
      const key = `${practiceSessionId}:${stepName}`;
      if (countedStepsRef.current.has(key)) return;
      countedStepsRef.current.add(key);
      if (stepName === "dialogue") trackDialogueStarted();
      else trackResultViewed();
    },
    [],
  );

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, mode]);

  useEffect(
    () => () => {
      if (waitTimer.current) clearInterval(waitTimer.current);
      if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      uploadControllerRef.current?.abort();
    },
    [videoUrl],
  );

  const startWaiting = () => {
    setAnalyzeLabel(ANALYZE_LABEL);
    setServerWaiting(true);
    setWaitedSec(0);
    // 폰이 잠기면 브라우저가 interval 을 억제한다 — 콜백을 세지 말고 시계에서 뺀다.
    waitStartedAt.current = Date.now();
    if (waitTimer.current) clearInterval(waitTimer.current);
    waitTimer.current = setInterval(
      () => setWaitedSec(Math.floor((Date.now() - waitStartedAt.current) / 1000)),
      1000,
    );
  };
  const stopWaiting = () => {
    if (waitTimer.current) clearInterval(waitTimer.current);
    waitTimer.current = null;
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    giveUpTimer.current = null;
    setServerWaiting(false);
  };

  const resetToPrep = useCallback(() => {
    setMode("prep");
    setActiveId(null);
    setDetail(null);
    setMessages([]);
    setReport(null);
    setCoachDone(false);
    coachIdRef.current = null;
    setError(null);
    setStalled(false);
    setSituation("");
    setCharacter("");
    setGoal("");
    setVideoFile(null);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDrawerOpen(false);
  }, []);

  const pushAi = (turn: CoachTurnResponse) => {
    // 코치 세션 id 는 매 응답마다 회전할 수 있어 다음 reply/report 에 최신 값을 쓴다.
    coachIdRef.current = turn.session_id;
    const at = turn.focus_timestamp?.trim() ? turn.focus_timestamp.trim() : undefined;
    setMessages((m) => [...m, { role: "ai", text: turn.utterance, at }]);
    if (turn.done) setCoachDone(true);
  };

  const onPickFile = (file: File | null) => {
    if (!file) return;
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setVideoFile(file);
    setError(null);
  };

  const begin = useCallback(async () => {
    if (!videoFile) return;
    setError(null);
    setStalled(false);
    gaveUpRef.current = false;
    setMode("analyzing");
    setPct(0);
    setAnalyzeLabel("영상 정보를 확인하고 있어요…");
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    try {
      const prepared = await prepareVideoUpload(videoFile, {
        signal: controller.signal,
        onCompressionProgress: (progress) => {
          setAnalyzeLabel("영상 압축 중…");
          setPct(progress * COMPRESS_END);
        },
      });
      setAnalyzeLabel("영상 업로드 중…");
      const { intentId } = await uploadVideo(prepared.file, {
        durationMs: prepared.durationMs,
        signal: controller.signal,
        onProgress: (progress) =>
          setPct(COMPRESS_END + (progress.percent / 100) * (UPLOAD_END - COMPRESS_END)),
      });
      startWaiting();
      // 세 번째 칸은 화면에서 "목표"로 묻지만 API 계약은 아직 subtext 다.
      // 백엔드가 goal 을 받게 되면 이 줄만 바꾸면 된다.
      const { session } = await createPracticeSession(
        {
          upload_intent_id: intentId,
          situation,
          character_context: character,
          subtext: goal,
        },
        { signal: controller.signal },
      );
      setActiveId(session.session_id);
      // 업로드가 끝난 시점이 아니라 연습 세션까지 만들어진 시점에 센다.
      // 업로드만 되고 세션 생성이 실패하면 연습이 시작된 게 아니다.
      trackVideoUploaded(prepared.durationMs);
      // 폴링 자체에는 끝이 없다 — 서버가 analyzing 에 머물면 영원히 기다린다.
      giveUpTimer.current = setTimeout(() => {
        gaveUpRef.current = true;
        controller.abort();
      }, GIVE_UP_MS);
      const settled = await pollSessionUntilSettled(session.session_id, {
        intervalMs: 4000,
        signal: controller.signal,
      });
      // 제한시간은 폴링만 묶는다 — 여기서 풀지 않으면 뒤이은 startCoach 중에 타이머가 터진다.
      if (giveUpTimer.current) {
        clearTimeout(giveUpTimer.current);
        giveUpTimer.current = null;
      }
      if (settled.status === "failed") {
        throw new Error(analysisFailure(settled.error_code).message);
      }
      const summaryId = settled.summary?.summary_id;
      if (!summaryId) throw new Error("분석 요약을 불러오지 못했어요.");
      const { data: start } = await startCoach({ summary_id: summaryId });
      if (controller.signal.aborted || uploadControllerRef.current !== controller) return;
      stopWaiting();
      setDetail(settled);
      setMode("chat");
      pushAi(start);
      // 첫 질문이 실제로 화면에 올라온 이 지점만 "대화 시작"이다. 아래 openSession·
      // 주소 진입에서 노트 없는 세션을 열며 chat 으로 가는 건 이어 하기라 세지 않는다.
      countStepOnce(session.session_id, "dialogue");
      void refreshList();
    } catch (err) {
      if (uploadControllerRef.current === controller) {
        stopWaiting();
        if (gaveUpRef.current) {
          setStalled(true);
        } else {
          setMode("prep");
          if (!(err instanceof Error && err.name === "AbortError")) {
            setError(err instanceof Error ? err.message : "문제가 생겼어요. 다시 시도해 주세요.");
          }
        }
      }
    } finally {
      stopWaiting();
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
    }
  }, [videoFile, situation, character, goal, refreshList, countStepOnce]);

  const send = useCallback(async () => {
    const text = answer.trim();
    if (!text || sending || !coachIdRef.current) return;
    setMessages((m) => [...m, { role: "me", text }]);
    setAnswer("");
    setSending(true);
    try {
      const { data: turn } = await replyCoach({ session_id: coachIdRef.current, text });
      pushAi(turn);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "ai", text: "(연결이 잠시 끊겼어요. 다시 답해 주세요.)" },
      ]);
    } finally {
      setSending(false);
    }
  }, [answer, sending]);

  const buildNote = useCallback(async () => {
    if (!coachIdRef.current) return;
    setBusy(true);
    try {
      const { data } = await createReport({ session_id: coachIdRef.current });
      setReport(data.report);
      setReportCount(data.report_count);
      setMode("note");
      // 본문까지 받아온 뒤에 센다. 실패하면 아래 catch 로 빠져 노트 화면이 뜨지 않는다.
      countStepOnce(activeId, "result");
      void refreshList();
    } catch {
      setError("연습 노트를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }, [activeId, countStepOnce, refreshList]);

  const openSession = useCallback(async (id: string) => {
    setDrawerOpen(false);
    setError(null);
    setActiveId(id);
    setMessages([]);
    setCoachDone(false);
    coachIdRef.current = null;
    setBusy(true);
    try {
      const loaded = await getPracticeSession(id);
      setDetail(loaded);
      try {
        const found = await getReport(id);
        setReport(found.report);
        setMode("note");
        countStepOnce(id, "result");
      } catch {
        // 노트가 아직 없는 세션 — 장면만 보여주고 대화는 비운다.
        setReport(null);
        setMode("chat");
      }
    } catch {
      setError("연습을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }, [countStepOnce]);

  // 주소에 ?session= 이 실려 오면(연습 기록 링크·새로고침) 그 세션을 연다.
  // 클릭으로 여는 경로는 openSession 이고, 이쪽은 첫 진입만 맡는다.
  const urlLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !sessionParam || urlLoadedRef.current === sessionParam) return;
    urlLoadedRef.current = sessionParam;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getPracticeSession(sessionParam);
        if (cancelled) return;
        setActiveId(sessionParam);
        setDetail(loaded);
        try {
          const found = await getReport(sessionParam);
          if (cancelled) return;
          setReport(found.report);
          setMode("note");
          countStepOnce(sessionParam, "result");
        } catch {
          if (cancelled) return;
          setReport(null);
          setMode("chat");
        }
      } catch {
        if (!cancelled) setError("연습을 찾을 수 없어요.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, sessionParam, countStepOnce]);

  const removeSession = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await deletePracticeSession(activeId);
      resetToPrep();
      void refreshList();
    } catch {
      setError("연습을 지우지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }, [activeId, resetToPrep, refreshList]);

  if (!ready) return <div className="min-h-dvh bg-white" aria-busy="true" />;

  const noteBySession = new Set(reports.map((r) => r.practice_session_id));
  const headlineBySession = new Map(reports.map((r) => [r.practice_session_id, r.headline]));
  const running = sessions.filter((s) => s.status === "created" || s.status === "analyzing");
  const finished = sessions.filter((s) => s.status === "analyzed" || s.status === "failed");
  const step: 1 | 2 | 3 = mode === "analyzing" ? 3 : videoFile ? 2 : 1;
  const chatLeading = mode === "chat" || mode === "note";
  const displayName = formatName();

  const rail = (
    <SessionRail
      open={railOpen}
      onToggle={() => setRailOpen((v) => !v)}
      onNew={resetToPrep}
      onOpen={openSession}
      running={running}
      finished={finished}
      activeId={activeId}
      hasNote={noteBySession}
      headlines={headlineBySession}
      listError={listError}
      displayName={displayName}
      onLogout={() => void logout().then(() => router.replace("/login"))}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-white text-[#191f28]">
      {/* 데스크톱: 붙박이 세션 바. 질문이 시작되면 접혀서 대화에 자리를 내준다. */}
      <div className="hidden lg:flex">{rail}</div>

      {/* 폰: 같은 목록이 왼쪽 드로어로 열린다. */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex bg-[#0f141e]/45 lg:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDrawerOpen(false);
          }}
        >
          <div className="flex h-full">
            <SessionRail
              open
              drawer
              onToggle={() => setDrawerOpen(false)}
              onNew={resetToPrep}
              onOpen={openSession}
              running={running}
              finished={finished}
              activeId={activeId}
              hasNote={noteBySession}
              headlines={headlineBySession}
              listError={listError}
              displayName={displayName}
              onLogout={() => void logout().then(() => router.replace("/login"))}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[#edf0f3] bg-white px-3.5 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="지난 연습 목록 열기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#f2f4f6] text-sm font-black text-[#4e5968] lg:hidden"
          >
            ☰
          </button>
          {/* flex-1 이 없으면 상황이 길 때 이 줄이 헤더 밖으로 밀려 나간다 */}
          <p className="min-w-0 flex-1 truncate text-[15px] font-black tracking-[-0.03em]">
            {detail?.situation?.trim() || "새 연습"}
          </p>
          <StatusChip mode={mode} />
          {activeId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeSession()}
              className="ml-auto h-8 shrink-0 rounded-[10px] border border-[#f1aeb5] px-3 text-xs font-black text-[#e03131] transition hover:bg-[#fff5f5] disabled:text-[#f1aeb5]"
            >
              삭제
            </button>
          ) : (
            <span className="ml-auto hidden text-xs font-semibold text-[#8b95a1] sm:block">
              {mode === "analyzing" ? "분석이 끝나면 질문이 시작돼요" : "영상을 올리면 질문이 시작돼요"}
            </span>
          )}
        </header>

        {chatLeading ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:flex-row">
            <ScenePanel
              detail={detail}
              open={scenePanelOpen}
              onToggle={() => setScenePanelOpen((v) => !v)}
            />
            {mode === "note" ? (
              <NotePanel
                report={report}
                reportCount={reportCount}
                busy={busy}
                onBackToChat={() => setMode("chat")}
              />
            ) : (
              <ChatPanel
                messages={messages}
                answer={answer}
                setAnswer={setAnswer}
                sending={sending}
                done={coachDone}
                busy={busy}
                error={error}
                scrollRef={chatScrollRef}
                onSend={() => void send()}
                onBuildNote={() => void buildNote()}
                hasNote={Boolean(report)}
                onSeeNote={() => setMode("note")}
              />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-5 sm:py-8">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 sm:gap-6">
              <Stepper current={step} />
              {videoUrl ? (
                <VideoBox
                  src={videoUrl}
                  caption={
                    mode === "analyzing"
                      ? "분석 중에도 영상은 볼 수 있어요"
                      : videoFile?.name ?? "올린 영상"
                  }
                  onReselect={mode === "prep" ? () => fileInputRef.current?.click() : undefined}
                />
              ) : (
                <UploadZone onClick={() => fileInputRef.current?.click()} />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
              />
              <SceneForm
                situation={situation}
                character={character}
                goal={goal}
                locked={mode === "analyzing"}
                onSituation={setSituation}
                onCharacter={setCharacter}
                onGoal={setGoal}
              />
              {mode === "analyzing" ? (
                stalled ? (
                  <StalledNotice
                    onKeepWaiting={() => {
                      setStalled(false);
                      void refreshList();
                    }}
                    onRestart={resetToPrep}
                  />
                ) : (
                  <ProgressPanel
                    serverWaiting={serverWaiting}
                    waitedSec={waitedSec}
                    pct={pct}
                    label={analyzeLabel}
                  />
                )
              ) : (
                <StartRow ready={Boolean(videoFile)} onStart={() => void begin()} />
              )}
              {error ? (
                <p role="alert" className="rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]">
                  {error}
                </p>
              ) : null}
              <IntroLine />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 왼쪽 세션 바 ─────────────────────────────────────────────── */

function SessionRail({
  open,
  drawer = false,
  onToggle,
  onNew,
  onOpen,
  running,
  finished,
  activeId,
  hasNote,
  headlines,
  listError,
  displayName,
  onLogout,
}: {
  open: boolean;
  drawer?: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  running: PracticeSessionListItem[];
  finished: PracticeSessionListItem[];
  activeId: string | null;
  hasNote: Set<string>;
  headlines: Map<string, string>;
  listError: boolean;
  displayName: string;
  onLogout: () => void;
}) {
  const width = drawer ? "w-[300px]" : open ? "w-[280px]" : "w-16";
  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-[#edf0f3] bg-[#f9fafb] ${width}`}
    >
      <div className={`flex h-14 items-center ${open ? "justify-between px-4" : "justify-center"}`}>
        {open ? <Image src={wordmark} alt="Acttub" priority className="h-5 w-auto" /> : null}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "목록 접기" : "목록 펼치기"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-[#8b95a1] transition hover:bg-[#eef2f6]"
        >
          {drawer ? "✕" : open ? "«" : "»"}
        </button>
      </div>

      <div className={open ? "px-4" : "flex justify-center"}>
        <button
          type="button"
          onClick={onNew}
          className={`flex items-center justify-center gap-2 rounded-[14px] bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da] ${
            open ? "h-11 w-full" : "h-10 w-10"
          }`}
        >
          <span aria-hidden="true">＋</span>
          {open ? "새 연습" : <span className="sr-only">새 연습</span>}
        </button>
      </div>

      {open ? (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {listError ? (
            <p className="rounded-xl bg-[#fff8ec] px-3 py-2.5 text-xs font-bold leading-5 text-[#8a4b00]">
              목록을 잠시 불러오지 못했어요. 새 연습은 바로 시작할 수 있어요.
            </p>
          ) : null}
          {running.length > 0 ? (
            <RailGroup label="진행 중">
              {running.map((s) => (
                <RailItem
                  key={s.session_id}
                  title={s.situation?.trim() || "제목 없는 연습"}
                  meta={`${s.status === "analyzing" ? "분석 중" : "대기 중"} · ${whenLabel(s.created_at)}`}
                  active={s.session_id === activeId}
                  dot
                  onClick={() => onOpen(s.session_id)}
                />
              ))}
            </RailGroup>
          ) : null}
          <RailGroup label="지난 연습">
            {finished.length === 0 ? (
              <p className="px-2 py-3 text-xs font-semibold leading-5 text-[#8b95a1]">
                첫 영상을 올리면 여기에 쌓여요.
              </p>
            ) : (
              finished.map((s) => (
                <RailItem
                  key={s.session_id}
                  // ?? 는 빈 문자열을 통과시킨다 — 상황을 안 적은 세션이 제목 없이 렌더됐다.
                  // 진행 중 목록(위)은 || 를 써서 여기만 어긋나 있었다.
                  title={headlines.get(s.session_id)?.trim() || s.situation?.trim() || "제목 없는 연습"}
                  meta={`${whenLabel(s.created_at)}${hasNote.has(s.session_id) ? " · 문장 남김" : ""}`}
                  active={s.session_id === activeId}
                  onClick={() => onOpen(s.session_id)}
                />
              ))
            )}
          </RailGroup>
        </div>
      ) : (
        <div className="mt-5 flex flex-1 flex-col items-center gap-2 overflow-y-auto">
          {[...running, ...finished].slice(0, 8).map((s) => (
            <button
              key={s.session_id}
              type="button"
              onClick={() => onOpen(s.session_id)}
              title={s.situation}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-black transition ${
                s.session_id === activeId
                  ? "bg-[#e8f3ff] text-[#3182f6]"
                  : "bg-[#f2f4f6] text-[#8b95a1] hover:bg-[#eef2f6]"
              }`}
            >
              {(s.situation?.trim() || "연")[0]}
            </button>
          ))}
        </div>
      )}

      {/* 연습 밖으로 나가는 유일한 통로. 여기 없으면 커뮤니티는 주소를 아는 사람만 쓴다. */}
      <div
        className={`mt-auto border-t border-[#edf0f3] ${
          open ? "px-4 py-3" : "flex justify-center py-3"
        }`}
      >
        <Link
          href="/community"
          title="커뮤니티"
          className={
            open
              ? "block rounded-xl px-2 py-2 text-[13px] font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
              : "flex h-9 w-9 items-center justify-center rounded-xl bg-[#f2f4f6] text-[13px] font-black text-[#8b95a1] transition hover:bg-[#eef2f6]"
          }
        >
          {open ? "커뮤니티" : "커"}
        </Link>
      </div>

      <div
        className={`flex items-center border-t border-[#edf0f3] ${
          open ? "justify-between px-4 py-3.5" : "justify-center py-3.5"
        }`}
      >
        {open ? (
          <>
            {/* flex 자식은 min-width:auto 라서 min-w-0 없이는 truncate 가 먹지 않는다.
                로그아웃 버튼이 shrink-0 이라 긴 이메일이 바 밖으로 밀려 나갔다. */}
            <span className="min-w-0 flex-1 truncate text-[13px] font-black text-[#4e5968]">{displayName}</span>
            <button
              type="button"
              onClick={onLogout}
              className="shrink-0 text-[13px] font-semibold text-[#8b95a1] transition hover:text-[#191f28]"
            >
              로그아웃
            </button>
          </>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#191f28] text-[13px] font-black text-white">
            {displayName[0] ?? "배"}
          </span>
        )}
      </div>
    </aside>
  );
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="px-2 pb-2 text-[11.5px] font-black text-[#8b95a1]">{label}</p>
      {/* grid-cols-1 이 있어야 컬럼이 minmax(0,1fr) 이 된다. 없으면 암묵 컬럼이 auto 라
          min-content 가 하한이 되는데, 제목의 truncate 가 white-space:nowrap 을 걸어서
          min-content 가 제목 전체 길이가 된다 → 컬럼이 그만큼 벌어지고 truncate 가 안 먹는다. */}
      <div className="grid grid-cols-1 gap-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  title,
  meta,
  active,
  dot = false,
  onClick,
}: {
  title: string;
  meta: string;
  active: boolean;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-[#e8f3ff]" : "hover:bg-[#eef2f6]"
      }`}
    >
      {dot ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3182f6]" /> : null}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13.5px] ${
            active ? "font-black text-[#191f28]" : "font-bold text-[#333d4b]"
          }`}
        >
          {title}
        </span>
        <span className={`mt-0.5 block truncate text-xs font-semibold ${active ? "text-[#3182f6]" : "text-[#8b95a1]"}`}>
          {meta}
        </span>
      </span>
    </button>
  );
}

/* ── 준비 단계 ────────────────────────────────────────────────── */

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps: [string, string][] = [
    ["1", "영상 올리기"],
    ["2", "장면 적기"],
    ["3", "질문 받기"],
  ];
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {steps.map(([n, label], index) => {
        const position = index + 1;
        const done = position < current;
        const now = position === current;
        return (
          <li key={n} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-black ${
                done || now ? "bg-[#3182f6] text-white" : "bg-[#f2f4f6] text-[#b0b8c1]"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span
              className={`shrink-0 text-xs font-bold sm:text-[13px] ${
                now ? "font-black text-[#191f28]" : "text-[#8b95a1]"
              }`}
            >
              {label}
            </span>
            {position < steps.length ? <span className="h-px flex-1 bg-[#e5e8eb]" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function UploadZone({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-[#cfe0f5] bg-[#f8fbff] px-4 text-center transition hover:border-[#3182f6] hover:bg-[#e8f3ff] sm:h-[300px] sm:rounded-[20px]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl font-black text-[#3182f6] shadow-[0_8px_20px_rgba(49,130,246,0.12)] sm:h-14 sm:w-14">
        ＋
      </span>
      <span className="mt-1 block text-[15px] font-black tracking-[-0.02em] text-[#333d4b] sm:text-[17px]">
        오늘의 연기 영상을 올려 주세요
      </span>
      <span className="block text-xs font-semibold text-[#8b95a1] sm:text-[13px]">
        MP4 · MOV · 5분 이내 · 끌어다 놓아도 돼요
      </span>
    </button>
  );
}

function VideoBox({
  src,
  caption,
  onReselect,
}: {
  src: string;
  caption: string;
  onReselect?: () => void;
}) {
  return (
    <div>
      <video
        src={src}
        controls
        playsInline
        className="aspect-video max-h-[300px] w-full rounded-[18px] bg-black object-contain sm:rounded-[20px]"
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        {onReselect ? (
          <button
            type="button"
            onClick={onReselect}
            className="rounded-full bg-[#e8f3ff] px-3 py-1.5 text-xs font-black text-[#3182f6] transition hover:bg-[#dbeafe]"
          >
            ← 다시 선택
          </button>
        ) : null}
        {/* 파일명은 띄어쓰기 없이 길 수 있다 — min-w-0 없으면 flex 안에서 안 줄어든다 */}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#8b95a1]">{caption}</span>
      </div>
    </div>
  );
}

function SceneForm({
  situation,
  character,
  goal,
  locked,
  onSituation,
  onCharacter,
  onGoal,
}: {
  situation: string;
  character: string;
  goal: string;
  locked: boolean;
  onSituation: (v: string) => void;
  onCharacter: (v: string) => void;
  onGoal: (v: string) => void;
}) {
  return (
    <section
      className={`rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)] sm:rounded-[20px] sm:p-6 ${
        locked ? "opacity-55" : ""
      }`}
    >
      <h2 className="text-[15px] font-black tracking-[-0.03em] sm:text-base">
        이 장면에서 무엇을 연기했는지 알려 주세요
      </h2>
      <div className="mt-3 grid gap-3">
        <SceneField label="상황" value={situation} onChange={onSituation} disabled={locked} placeholder="예: 이별을 통보받은 직후, 카페에서" />
        <SceneField label="인물" value={character} onChange={onCharacter} disabled={locked} placeholder="예: 담담한 척하는 20대 후반 여성" />
        <SceneField label="목표" value={goal} onChange={onGoal} disabled={locked} placeholder="예: 상대가 마음을 돌려 다시 앉게 만들기" />
      </div>
      <p className="mt-3 text-xs font-semibold text-[#8b95a1]">
        비워 두셔도 돼요. 빈 칸은 대화에서 물어봐요.
      </p>
    </section>
  );
}

function SceneField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1.5 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-xs font-black text-[#333d4b]">{label}</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8fbff] px-3.5 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff]"
      />
    </label>
  );
}

function StartRow({ ready, onStart }: { ready: boolean; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
      <button
        type="button"
        disabled={!ready}
        onClick={onStart}
        className="h-12 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto"
      >
        질문 받기
      </button>
      <span className="text-xs font-semibold text-[#8b95a1]">
        {ready ? "누르면 장면을 보고 질문을 만들어요" : "영상을 올리면 시작할 수 있어요"}
      </span>
    </div>
  );
}

/**
 * 서버 대기 구간의 표시용 진행률(0~1). 서버는 analyzing/analyzed/failed 셋만 주므로
 * 진짜 진행률이 없다 — 실측 평균 시간에 맞춘 지수 곡선으로 채운다.
 *
 * ⚠️ 이전 구현은 60초에 상한(90)에 닿고 그 뒤로는 시간상수 90초짜리 crawl만 남아서,
 * 화면상 94.5%에서 사실상 멈춰 있었다 (2026-07-28 실사용: "95%에서 멈추다 갑자기 시작").
 * 상한에 부딪히는 구간을 없애고, 평균 시점에 약 80%가 되도록 시간상수를 잡는다.
 */
function waitingRatio(sec: number): number {
  return 1 - Math.exp(-sec / (AVG_ANALYZE_SEC / 1.6));
}

function ProgressPanel({
  serverWaiting,
  waitedSec,
  pct,
  label,
}: {
  serverWaiting: boolean;
  waitedSec: number;
  pct: number;
  label: string;
}) {
  // 업로드가 끝난 지점(UPLOAD_END)에서 이어받아 계속 오른다 — 되감기지 않는다.
  const shownPct = serverWaiting
    ? UPLOAD_END + (WAIT_CEILING - UPLOAD_END) * waitingRatio(waitedSec)
    : pct;
  return (
    <div aria-live="polite" className="rounded-[16px] bg-[#e8f3ff] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-xl font-black tabular-nums tracking-[-0.04em] text-[#3182f6]">
          {Math.round(shownPct)}%
        </span>
        <span className="text-xs font-semibold text-[#4e5968] sm:text-[13px]">{label}</span>
      </div>
      {/* 압축·업로드는 진짜 진행률, 서버 대기는 시간 기준 추정치다. */}
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full rounded-full bg-[#3182f6] transition-[width] ${
            serverWaiting ? "duration-1000 ease-linear" : "duration-300"
          }`}
          style={{ width: `${shownPct}%` }}
        />
      </div>
      <p className="mt-2.5 text-[11.5px] font-semibold leading-5 text-[#8b95a1]">
        {serverWaiting && waitedSec >= SLOW_NOTICE_SEC
          ? "장면이 길거나 앞에 기다리는 분석이 있으면 몇 분 더 걸려요. 이 화면을 닫아도 분석은 계속되고, 왼쪽 목록에서 이어볼 수 있어요."
          : "이 화면을 닫아도 분석은 계속돼요. 끝나면 왼쪽 목록에서 이어볼 수 있어요."}
      </p>
    </div>
  );
}

function StalledNotice({
  onKeepWaiting,
  onRestart,
}: {
  onKeepWaiting: () => void;
  onRestart: () => void;
}) {
  return (
    <div role="alert" className="rounded-[16px] bg-[#fff8e8] px-4 py-4 sm:px-5">
      <p className="text-sm font-black text-[#333d4b]">분석이 예상보다 오래 걸리고 있어요</p>
      <p className="mt-1.5 text-xs font-semibold leading-5 text-[#4e5968]">
        영상은 이미 저장됐고 분석은 계속 진행돼요. 이 화면을 닫아도 되고, 끝나면 왼쪽 목록에서
        이어볼 수 있어요.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onKeepWaiting}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[#3182f6] px-4 text-xs font-black text-white transition hover:bg-[#1b64da]"
        >
          목록 새로 보기
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
        >
          다른 영상으로 다시 하기
        </button>
      </div>
    </div>
  );
}

function IntroLine() {
  return (
    <p className="text-center text-xs font-semibold leading-5 text-[#8b95a1]">
      영상에서 눈에 남은 곳을 묻고, 마지막 한 문장은 배우님이 직접 씁니다.{" "}
      <Link href="/terms" className="font-black text-[#4e5968] underline-offset-2 hover:underline">
        안전 약속 보기
      </Link>
    </p>
  );
}

/* ── 대화 · 장면 · 노트 ───────────────────────────────────────── */

function ScenePanel({
  detail,
  open,
  onToggle,
}: {
  detail: PracticeSessionDetail | null;
  open: boolean;
  onToggle: () => void;
}) {
  const rows: [string, string][] = [
    ["상황", detail?.situation?.trim() || "적지 않았어요"],
    ["인물", detail?.character_context?.trim() || "적지 않았어요"],
    ["목표", detail?.subtext?.trim() || "적지 않았어요"],
  ];

  return (
    <>
      {/* 폰: 대화 위 접이식 스트립 한 줄 */}
      <details className="group shrink-0 overflow-hidden rounded-[16px] bg-[#f9fafb] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
          <span className="flex h-8 w-[52px] shrink-0 items-center justify-center rounded-lg bg-[#1b2942] text-[10px] font-black text-white">
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-black text-[#333d4b]">영상과 장면 보기</span>
            <span className="block truncate text-[11.5px] font-semibold text-[#8b95a1]">
              {detail?.situation?.trim() || "장면을 적지 않았어요"}
            </span>
          </span>
          <span aria-hidden="true" className="text-xs font-black text-[#8b95a1]">▾</span>
        </summary>
        <div className="px-3 pb-3">
          {detail?.playback_url ? (
            <video
              key={detail.playback_url}
              src={detail.playback_url}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black object-contain"
            />
          ) : null}
          <SceneRows rows={rows} />
        </div>
      </details>

      {/* 데스크톱: 접히는 왼쪽 패널 */}
      {open ? (
        <div className="hidden w-[340px] shrink-0 flex-col gap-3 lg:flex">
          {detail?.playback_url ? (
            <div className="rounded-[18px] bg-white p-3 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
              <video
                key={detail.playback_url}
                src={detail.playback_url}
                controls
                preload="metadata"
                className="aspect-video w-full rounded-xl bg-black object-contain"
              />
              <p className="mt-2 text-[11.5px] font-semibold text-[#8b95a1]">
                구간을 누르면 그 지점부터 재생돼요
              </p>
            </div>
          ) : null}
          <div className="rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
            <p className="text-[13.5px] font-black">이 장면에서 연기한 것</p>
            <SceneRows rows={rows} />
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-[#f2f4f6] text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
          >
            « 장면 접기
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label="장면 펼치기"
          className="hidden h-full w-12 shrink-0 flex-col items-center gap-2 rounded-[16px] bg-[#f9fafb] py-2 text-sm font-black text-[#8b95a1] transition hover:bg-[#eef2f6] lg:flex"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white">»</span>
        </button>
      )}
    </>
  );
}

function SceneRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-3 grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11.5px] font-black text-[#8b95a1]">{label}</dt>
          {/* 상황을 길게 적으면 줄바꿈 없이 밀고 나가는 경우가 있어 강제로 끊는다 */}
          <dd className="break-words text-[12.5px] font-semibold leading-5 text-[#333d4b]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChatPanel({
  messages,
  answer,
  setAnswer,
  sending,
  done,
  busy,
  error,
  scrollRef,
  onSend,
  onBuildNote,
  hasNote,
  onSeeNote,
}: {
  messages: ChatMsg[];
  answer: string;
  setAnswer: (v: string) => void;
  sending: boolean;
  done: boolean;
  busy: boolean;
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: () => void;
  onBuildNote: () => void;
  hasNote: boolean;
  onSeeNote: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
          현재 장면을 바탕으로 질문하고 있어요
        </span>
        <span className="hidden text-xs font-semibold text-[#8b95a1] sm:block">
          &apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요
        </span>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="질문과 답변"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5 sm:p-4"
      >
        {/* justify-end 를 쓰면 안 된다 — flex 컬럼에서 넘친 내용이 위쪽으로 삐져나가
            스크롤로 닿지 않는다. 대화가 길어지면 앞 질문을 볼 수 없었다 (2026-07-28).
            대신 안쪽을 mt-auto 로 밀어, 짧은 대화는 아래에 붙고 길어지면 정상 스크롤된다. */}
        {messages.length === 0 ? (
          <p className="my-auto text-center text-[13px] font-semibold leading-6 text-[#b0b8c1]">
            이 연습에는 아직 오간 질문이 없어요.
          </p>
        ) : (
          <div className="mt-auto flex flex-col gap-3 sm:gap-4">
            {messages.map((m, index) => (
              <Bubble key={`${m.role}-${index}`} msg={m} />
            ))}
          </div>
        )}
      </div>

      {done ? (
        <div className="border-t border-[#edf0f3] p-3 sm:p-4">
          <button
            type="button"
            disabled={busy}
            onClick={hasNote ? onSeeNote : onBuildNote}
            className="h-12 w-full rounded-[14px] bg-[#3182f6] text-sm font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]"
          >
            {busy ? "연습 노트를 정리하는 중…" : hasNote ? "연습 노트 보기" : "대화를 바탕으로 연습 노트 만들기"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 border-t border-[#edf0f3] p-3 sm:p-3.5">
          <input
            value={answer}
            disabled={sending}
            placeholder="답을 편하게 적어 주세요"
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && answer.trim()) {
                event.preventDefault();
                onSend();
              }
            }}
            className="h-12 min-w-0 flex-1 rounded-full border border-[#e5e8eb] bg-[#f8fbff] px-5 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white sm:h-14"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !answer.trim()}
            aria-label="답변 보내기"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#3182f6] text-lg font-black text-white shadow-[0_8px_20px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:h-14 sm:w-14"
          >
            ↑
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="border-t border-[#edf0f3] px-4 py-3 text-sm font-bold text-[#e42939]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const mine = msg.role === "me";
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine ? (
        <span
          aria-hidden="true"
          className="h-7 w-7 shrink-0 rounded-full bg-[linear-gradient(225deg,#44c0fd,#0355f1)]"
        />
      ) : null}
      <div
        className={`max-w-[82%] whitespace-pre-wrap rounded-[18px] px-4 py-3 text-[15px] font-semibold leading-[1.7] ${
          mine ? "rounded-br-[6px] bg-[#3182f6] text-white" : "rounded-bl-[6px] bg-[#f8fbff] text-[#191f28]"
        }`}
      >
        {msg.text}
      </div>
    </div>
  );
}

function NotePanel({
  report,
  reportCount,
  busy,
  onBackToChat,
}: {
  report: ActingReport | null;
  reportCount: number;
  busy: boolean;
  onBackToChat: () => void;
}) {
  if (!report) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-[20px] bg-white p-8 text-center shadow-[0_12px_36px_rgba(25,31,40,0.06)]">
        <p className="text-sm font-semibold text-[#8b95a1]">
          {busy ? "연습 노트를 정리하는 중이에요…" : "아직 연습 노트가 없어요."}
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
      <header className="border-b border-[#edf0f3] px-5 pb-4 pt-5 sm:px-6">
        <p className="text-xs font-black text-[#3182f6]">{reportCount}번째 연습 노트</p>
        <h2 className="mt-2 text-xl font-black leading-snug tracking-[-0.04em] sm:text-2xl">
          {report.headline}
        </h2>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:p-5">
        <article className="rounded-[18px] border border-[#dce9ff] bg-[#f7faff] p-4 sm:p-5">
          <p className="text-xs font-black text-[#3182f6]">다시 본 순간</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h3 className="text-[15px] font-black tracking-[-0.03em]">영상에서 눈에 남은 곳</h3>
            <span className="inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#3182f6]">
              {report.biggest_problem.start} – {report.biggest_problem.end}
            </span>
          </div>
          <p className="mt-2.5 whitespace-pre-wrap text-sm font-semibold leading-[1.75] text-[#333d4b]">
            {report.biggest_problem.description}
          </p>
        </article>

        <NoteCard title="대화에서 확인한 것" body={report.evidence} />

        <article className="flex items-start gap-3.5 rounded-[18px] border border-[#e5e8eb] bg-white p-4 sm:p-5">
          <span className="mt-0.5 h-12 w-[3px] shrink-0 rounded-full bg-[#3182f6]" />
          <div className="min-w-0">
            <p className="text-xs font-black text-[#3182f6]">배우님이 남긴 문장</p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] font-black leading-[1.65] tracking-[-0.02em]">
              {report.self_discovery}
            </p>
          </div>
        </article>

        <NoteCard title="다음 테이크" body={report.next_step} tone="blue" />
      </div>

      <div className="flex gap-2.5 border-t border-[#edf0f3] p-3.5 sm:p-4">
        <button
          type="button"
          onClick={onBackToChat}
          className="h-12 flex-1 rounded-[14px] bg-[#f8fbff] text-sm font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
        >
          대화 다시 보기
        </button>
        {/* 새 창으로 연다 — 보던 노트를 유지한 채 후기를 남길 수 있게 */}
        <a
          href={REVIEW_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="연습 마치고 후기 남기기 (새 창)"
          className="flex h-12 flex-1 items-center justify-center rounded-[14px] bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da]"
        >
          연습 마치기 ↗
        </a>
      </div>
    </section>
  );
}

function NoteCard({
  title,
  body,
  tone = "gray",
}: {
  title: string;
  body: string;
  tone?: "gray" | "blue";
}) {
  return (
    <article
      className={`rounded-[18px] border p-4 sm:p-5 ${
        tone === "blue" ? "border-[#dce9ff] bg-[#f7faff]" : "border-[#e5e8eb] bg-white"
      }`}
    >
      <h3 className="text-[15px] font-black tracking-[-0.03em]">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-[1.75] text-[#4e5968]">
        {body}
      </p>
    </article>
  );
}

function StatusChip({ mode }: { mode: Mode }) {
  if (mode === "prep") return null;
  const map: Record<Exclude<Mode, "prep">, [string, string]> = {
    analyzing: ["분석 중", "bg-[#e8f3ff] text-[#3182f6]"],
    chat: ["질문 대화 중", "bg-[#e8f3ff] text-[#3182f6]"],
    note: ["연습 노트", "bg-[#e5f8ef] text-[#009959]"],
  };
  const [label, tone] = map[mode];
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-black ${tone}`}>
      {label}
    </span>
  );
}

/* ── 잡다한 것 ────────────────────────────────────────────────── */

// 언제 한 연습인지 목록에서 바로 보이게 날짜와 시각을 같이 준다 (2026-07-28).
// 이전에는 "3일 전"처럼 상대 표기만 있어서 같은 날 여러 번 연습하면 구분이 안 됐다.
// 하루 경과는 밀리초 차이가 아니라 달력 날짜로 센다 — 어젯밤 23시와 오늘 1시는 하루 차이다.
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function whenLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  const now = new Date();
  const time = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `오늘 ${time}`;
  if (days === 1) return `어제 ${time}`;
  const day = new Intl.DateTimeFormat("ko-KR", {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
  }).format(date);
  return `${day} ${time}`;
}

function formatName(): string {
  const email = getStoredUser()?.email;
  if (!email) return "배우";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "배우";
}
