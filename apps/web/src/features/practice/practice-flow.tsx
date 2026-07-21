"use client";

import { Suspense, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import wordmark from "@/assets/acttub-wordmark.png";
import { useRouter, useSearchParams } from "next/navigation";
import { getStoredDisplayName } from "@/features/auth/display-name";
import { useRequireAuth } from "@/features/auth/use-require-auth";
import { replyCoach, startCoach } from "@/lib/api/v2/coach";
import { ApiError } from "@/lib/api/v2/errors";
import { createReport, listReports } from "@/lib/api/v2/reports";
import {
  createPracticeSession,
  getPracticeSession,
  listPracticeSessions,
  pollSessionUntilSettled,
  reanalyzeSession,
} from "@/lib/api/v2/sessions";
import type {
  ActingReport,
  AuthUser,
  CoachTurnResponse,
  PracticeSessionDetail,
  PracticeSessionListItem,
  ReportRecord,
} from "@/lib/api/v2/types";
import { UploadError, uploadVideo } from "@/lib/api/v2/uploads";
import { logout } from "@/lib/api/v2/auth";
import { prepareVideoUpload } from "@/lib/media/upload-preflight";

type Entry = "home" | "new" | "history";
type Step = "home" | "history" | "video" | "context";
type Phase = "summary" | "coaching" | "report";
type CoachTurn = {
  role: "coach" | "actor";
  text: string;
  action?: CoachTurnResponse["action"];
  focusTimestamp?: string;
};
type CoachState = {
  coachSessionId: string;
  turns: CoachTurn[];
  questionCount: number;
  done: boolean;
  reason: CoachTurnResponse["reason"];
};
type ReportData = { report: ActingReport; reportCount: number };
type UploadProgressState = {
  percent: number;
  stage: "compressing" | "uploading";
};

// v2 연습 노트에는 practice_session_id가 없어 현재 탭에서 확인한 연결만 보존한다.
const practiceCoachSessionMap = new Map<string, string>();

const entryInitialStep: Record<Entry, Step> = {
  home: "home",
  new: "video",
  history: "history",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했어요.";
}

function sessionErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "세션을 찾을 수 없어요";
  return errorMessage(error);
}

function normalizeReportTurns(turns: unknown[]): CoachTurn[] {
  return turns.flatMap((turn) => {
    if (!turn || typeof turn !== "object") return [];
    const role = "role" in turn ? turn.role : undefined;
    const text = "text" in turn ? turn.text : undefined;
    if ((role !== "ai" && role !== "actor") || typeof text !== "string") return [];
    return [{ role: role === "ai" ? "coach" : "actor", text } satisfies CoachTurn];
  });
}

function reportTurnsForStorage(turns: CoachTurn[]): ReportRecord["turns"] {
  return turns.map((turn) => ({
    role: turn.role === "coach" ? "ai" : "actor",
    text: turn.text,
  }));
}

// 세션 상세는 이 주소 한 곳에서만 연다 — 주소에 세션 id가 남아야
// 뒤로가기·새로고침·링크 공유가 동작한다. (정적 export라 /history/[id] 경로는 못 쓴다)
const SESSION_DETAIL_PATH = "/practice/history";
const sessionDetailHref = (sessionId: string) =>
  `${SESSION_DETAIL_PATH}?session=${encodeURIComponent(sessionId)}`;

export function PracticeFlow({ entry = "new" }: { entry?: Entry }) {
  // useSearchParams는 정적 export에서 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={<LoadingScreen message="연습 공간을 준비하는 중이에요." />}>
      <PracticeFlowInner entry={entry} />
    </Suspense>
  );
}

function PracticeFlowInner({ entry = "new" }: { entry?: Entry }) {
  const router = useRouter();
  const sessionParam = useSearchParams().get("session");
  const { ready: authReady, user } = useRequireAuth();
  const [dataReady, setDataReady] = useState(false);
  const [step, setStep] = useState<Step>(entryInitialStep[entry]);
  const [history, setHistory] = useState<PracticeSessionListItem[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [active, setActive] = useState<{ sessionId: string } | null>(null);
  const [sessionDetail, setSessionDetail] = useState<PracticeSessionDetail | null>(null);
  const [phase, setPhase] = useState<Phase>("summary");
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportTurns, setReportTurns] = useState<CoachTurn[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [situation, setSituation] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [subtext, setSubtext] = useState("");
  const [answer, setAnswer] = useState("");
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coachWaiting, setCoachWaiting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const playbackRefreshAttemptedRef = useRef(false);

  // 배우가 정한 호칭. 묻는 건 첫 로그인 때 로그인 화면에서 하고, 여기서는 읽기만 한다.
  const [storedName, setStoredName] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 localStorage 확인 (서버 렌더와 값이 달라 초기값으로 못 읽는다)
    setStoredName(getStoredDisplayName());
  }, []);

  // 주소의 ?session=<id>가 상세 화면의 단일 기준이다.
  // 카드 클릭·뒤로가기·새로고침·링크 직접 진입이 모두 이 한 경로로 처리된다.
  useEffect(() => {
    if (!sessionParam) {
      clearActiveSession();
      return;
    }
    resetActiveFlow(sessionParam);
    void pollSession(sessionParam);
    // 주소가 바뀌거나 화면을 떠나면 진행 중이던 조회를 끊는다.
    // (개발 모드의 이중 마운트에서도 정리 후 다시 시작되므로 멈추지 않는다)
    return () => {
      pollControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 주소가 바뀔 때만 다시 연다
  }, [sessionParam]);

  useEffect(() => {
    if (!authReady) return;
    let activeLoad = true;

    void Promise.allSettled([listPracticeSessions(), listReports()]).then(
      ([sessionsResult, reportsResult]) => {
        if (!activeLoad) return;
        setStep(entryInitialStep[entry]);
        setHistoryError(null);

        if (sessionsResult.status === "fulfilled") {
          setHistory(sessionsResult.value.sessions);
        } else {
          setHistory([]);
          setHistoryError(errorMessage(sessionsResult.reason));
        }

        if (reportsResult.status === "fulfilled") {
          setReports(reportsResult.value.reports);
        } else {
          setReports([]);
          if (sessionsResult.status === "fulfilled") {
            setHistoryError("완료된 연습 노트 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
          }
        }
        setDataReady(true);
      },
    );

    return () => {
      activeLoad = false;
    };
  }, [authReady, entry]);

  useEffect(
    () => () => {
      pollControllerRef.current?.abort();
      uploadControllerRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function selectUploadFile(nextFile: File | null) {
    if (!nextFile) return;
    if (nextFile.size <= 0) {
      setError("비어 있는 영상은 업로드할 수 없어요.");
      return;
    }
    if (nextFile.type !== "video/mp4" && nextFile.type !== "video/quicktime") {
      setError("MP4 또는 MOV 영상만 업로드할 수 있어요.");
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setFile(nextFile);
    setUploadProgress(null);
    setError(null);
    setStep("context");
  }

  function returnToVideoSelection() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    setUploadProgress(null);
    setError(null);
    setStep("video");
  }

  function linkedReportForSession(
    practiceSessionId: string,
    sourceReports: ReportRecord[] = reports,
  ): ReportRecord | undefined {
    const coachSessionId = practiceCoachSessionMap.get(practiceSessionId);
    if (!coachSessionId) return undefined;
    return sourceReports.find((report) => report.session_id === coachSessionId);
  }

  function reportForSession(practiceSessionId: string): ReportRecord | undefined {
    return linkedReportForSession(practiceSessionId);
  }

  function upsertHistory(session: PracticeSessionDetail) {
    setHistory((items) => [
      session,
      ...items.filter((item) => item.session_id !== session.session_id),
    ]);
  }

  function showReportRecord(record: ReportRecord, sourceReports: ReportRecord[]) {
    const reportIndex = sourceReports.findIndex(
      (candidate) => candidate.session_id === record.session_id,
    );
    setReportData({ report: record.report, reportCount: reportIndex + 1 });
    setReportTurns(normalizeReportTurns(record.turns));
    setPhase("report");
  }

  function applySessionDetail(session: PracticeSessionDetail, sourceReports = reports) {
    setSessionDetail(session);
    upsertHistory(session);

    if (session.status === "failed") {
      setPhase("summary");
      setError(null);
      return;
    }

    if (session.status === "analyzed") {
      const linkedReport = linkedReportForSession(session.session_id, sourceReports);
      if (linkedReport) showReportRecord(linkedReport, sourceReports);
      else setPhase("summary");
      setError(null);
    }
  }

  async function pollSession(sessionId: string): Promise<PracticeSessionDetail | null> {
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;

    try {
      const settled = await pollSessionUntilSettled(sessionId, {
        signal: controller.signal,
        onTick: (session) => {
          if (controller.signal.aborted) return;
          setSessionDetail(session);
          upsertHistory(session);
        },
      });
      if (controller.signal.aborted) return null;
      applySessionDetail(settled);
      return settled;
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof Error && reason.name === "AbortError")) {
        return null;
      }
      setError(sessionErrorMessage(reason));
      return null;
    } finally {
      if (pollControllerRef.current === controller) pollControllerRef.current = null;
    }
  }

  // 목록으로 돌아왔다 — 진행 중이던 폴링을 끊고 상세 상태를 비운다
  function clearActiveSession() {
    pollControllerRef.current?.abort();
    setActive(null);
    setSessionDetail(null);
    setError(null);
  }

  function resetActiveFlow(sessionId: string) {
    setActive({ sessionId });
    setSessionDetail(null);
    setPhase("summary");
    setCoach(null);
    setReportData(null);
    setReportTurns([]);
    setAnswer("");
    setPendingAnswer(null);
    setCoachWaiting(false);
    setError(null);
    playbackRefreshAttemptedRef.current = false;
  }

  function openSession(session: PracticeSessionListItem) {
    // 상태를 직접 바꾸지 않고 주소를 바꾼다 — 나머지는 위 동기화 effect가 처리한다
    router.push(sessionDetailHref(session.session_id));
  }

  async function begin() {
    if (!file || !situation.trim() || !characterContext.trim() || !subtext.trim()) {
      setError("영상, 상황, 인물 정보와 서브텍스트를 모두 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setUploadProgress({ percent: 0, stage: "compressing" });
    const controller = new AbortController();
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = controller;

    try {
      const prepared = await prepareVideoUpload(file, {
        signal: controller.signal,
        onCompressionProgress: (progress) =>
          setUploadProgress({ percent: Math.round(progress * 100), stage: "compressing" }),
      });
      setUploadProgress({ percent: 0, stage: "uploading" });
      const upload = await uploadVideo(prepared.file, {
        durationMs: prepared.durationMs,
        signal: controller.signal,
        onProgress: (progress) =>
          setUploadProgress({ percent: progress.percent, stage: "uploading" }),
      });
      const created = await createPracticeSession(
        {
          upload_intent_id: upload.intentId,
          situation: situation.trim(),
          character_context: characterContext.trim(),
          subtext: subtext.trim(),
        },
        { signal: controller.signal },
      );
      resetActiveFlow(created.session.session_id);
      void pollSession(created.session.session_id);
    } catch (reason) {
      if (uploadControllerRef.current === controller) {
        if (!(reason instanceof Error && reason.name === "AbortError")) {
          if (reason instanceof UploadError) {
            if (reason.stage === "intent") setError("업로드를 준비하지 못했어요.");
            else setError(reason.message);
          } else {
            setError(errorMessage(reason));
          }
        }
      }
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        setUploadProgress(null);
        setBusy(false);
      }
    }
  }

  async function startInterview() {
    const summaryId = sessionDetail?.summary?.summary_id;
    if (!active || !summaryId) {
      setError("세션을 찾을 수 없어요");
      return;
    }
    setBusy(true);
    setCoachWaiting(false);
    setError(null);
    try {
      const { data } = await startCoach(
        { summary_id: summaryId },
        { onWait: () => setCoachWaiting(true) },
      );
      const nextCoach: CoachState = {
        coachSessionId: data.session_id,
        turns: [
          {
            role: "coach",
            text: data.utterance,
            action: data.action,
            focusTimestamp: data.focus_timestamp,
          },
        ],
        questionCount: 1,
        done: data.done,
        reason: data.reason,
      };
      practiceCoachSessionMap.set(active.sessionId, data.session_id);
      setCoach(nextCoach);
      setReportData(null);
      setReportTurns([]);
      setPhase("coaching");
    } catch (reason) {
      setError(sessionErrorMessage(reason));
    } finally {
      setCoachWaiting(false);
      setBusy(false);
    }
  }

  async function reply() {
    const text = answer.trim();
    if (!active || !coach || coach.done || !text) return;
    setPendingAnswer(text);
    setBusy(true);
    setCoachWaiting(false);
    setError(null);
    try {
      const { data } = await replyCoach(
        { session_id: coach.coachSessionId, text },
        { onWait: () => setCoachWaiting(true) },
      );
      practiceCoachSessionMap.set(active.sessionId, data.session_id);
      setCoach({
        coachSessionId: data.session_id,
        turns: [
          ...coach.turns,
          { role: "actor", text },
          {
            role: "coach",
            text: data.utterance,
            action: data.action,
            focusTimestamp: data.focus_timestamp,
          },
        ],
        questionCount: coach.questionCount + 1,
        done: data.done,
        reason: data.reason,
      });
      setAnswer("");
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === "session changed concurrently"
      ) {
        setError("인터뷰 상태가 바뀌었어요. 마지막 답변을 다시 보내 주세요.");
      } else {
        setError(sessionErrorMessage(reason));
      }
    } finally {
      setPendingAnswer(null);
      setCoachWaiting(false);
      setBusy(false);
    }
  }

  async function retryAnalysis() {
    if (!active) return;
    setBusy(true);
    setError(null);
    setPhase("summary");
    setCoach(null);
    setReportData(null);
    setReportTurns([]);
    try {
      await reanalyzeSession(active.sessionId);
      setSessionDetail((current) =>
        current ? { ...current, status: "analyzing", error_code: null } : current,
      );
      void pollSession(active.sessionId);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        if (reason.code === "analysis_retry_exhausted") {
          setSessionDetail((current) =>
            current
              ? { ...current, status: "failed", error_code: "max_attempts_exceeded" }
              : current,
          );
          setError(null);
        } else if (reason.code === "session_is_not_failed") {
          try {
            const refreshed = await getPracticeSession(active.sessionId);
            if (refreshed.status === "created" || refreshed.status === "analyzing") {
              void pollSession(active.sessionId);
            } else {
              applySessionDetail(refreshed);
            }
          } catch (refreshError) {
            setError(sessionErrorMessage(refreshError));
          }
        } else {
          setError(errorMessage(reason));
        }
      } else {
        setError(sessionErrorMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  async function createActingReport() {
    if (!coach) return;
    const localTurns = coach.turns;
    setBusy(true);
    setCoachWaiting(false);
    setError(null);
    try {
      const { data } = await createReport(
        { session_id: coach.coachSessionId },
        { onWait: () => setCoachWaiting(true) },
      );
      setReportData({ report: data.report, reportCount: data.report_count });
      setReportTurns(localTurns);
      setPhase("report");
      const localRecord: ReportRecord = {
        created_at: new Date().toISOString(),
        session_id: coach.coachSessionId,
        report: data.report,
        turns: reportTurnsForStorage(localTurns),
      };
      setReports((current) => [
        ...current.filter((item) => item.session_id !== localRecord.session_id),
        localRecord,
      ]);
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === "report already exists for session"
      ) {
        try {
          const refreshed = await listReports();
          setReports(refreshed.reports);
          const existing = refreshed.reports.find(
            (item) => item.session_id === coach.coachSessionId,
          );
          if (!existing) throw new Error("완료된 연습 노트를 불러오지 못했어요.");
          showReportRecord(existing, refreshed.reports);
        } catch (refreshError) {
          setError(errorMessage(refreshError));
        }
      } else if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === "session is still open"
      ) {
        setError("인터뷰가 아직 진행 중이에요");
      } else {
        setError(sessionErrorMessage(reason));
      }
    } finally {
      setCoachWaiting(false);
      setBusy(false);
    }
  }

  async function refreshPlayback() {
    if (!active || playbackRefreshAttemptedRef.current) return;
    playbackRefreshAttemptedRef.current = true;
    try {
      const refreshed = await getPracticeSession(active.sessionId);
      setSessionDetail(refreshed);
      upsertHistory(refreshed);
    } catch (reason) {
      setError(sessionErrorMessage(reason));
    }
  }

  async function handleLogout() {
    await logout();
    practiceCoachSessionMap.clear();
    // 호칭은 지우지 않는다 — 계정 id와 함께 저장돼 있어 남의 이름으로 인사할 일이 없고,
    // 지우면 같은 사람이 다시 로그인할 때마다 "첫 로그인"으로 보여 또 묻게 된다.
    router.replace("/login");
  }

  function retryActiveSessionLoad() {
    const sessionId = sessionParam ?? active?.sessionId;
    if (!sessionId) return;
    setError(null);
    void pollSession(sessionId);
  }

  if (!authReady || !dataReady) {
    return <LoadingScreen message={error ?? "연습 공간을 준비하는 중이에요."} />;
  }

  // 주소에 세션이 있으면 effect가 돌기 전에도 곧바로 상세 화면으로 넘어간다 (목록이 깜빡이지 않게)
  const activeSessionId = sessionParam ?? active?.sessionId ?? null;

  if (activeSessionId && !sessionDetail) {
    return (
      <LoadingScreen
        message={error ?? "연습 세션을 불러오는 중이에요."}
        onRetry={error ? retryActiveSessionLoad : undefined}
      />
    );
  }

  if (activeSessionId && sessionDetail) {
    return (
      <SessionView
        session={sessionDetail}
        phase={phase}
        coach={coach}
        reportData={reportData}
        reportTurns={reportTurns}
        answer={answer}
        pendingAnswer={pendingAnswer}
        busy={busy}
        coachWaiting={coachWaiting}
        error={error}
        setAnswer={setAnswer}
        onStartCoach={startInterview}
        onReply={reply}
        onRetryAnalysis={retryAnalysis}
        onCreateReport={createActingReport}
        onPlaybackError={refreshPlayback}
        onRefreshSession={retryActiveSessionLoad}
      />
    );
  }

  const displayName = storedName ?? formatDisplayName(user);

  if (step === "home") {
    return (
      <PracticeHome
        displayName={displayName}
        historyError={historyError}
        sessions={history}
        reportForSession={reportForSession}
        onLogout={handleLogout}
        onOpen={openSession}
      />
    );
  }

  if (step === "history") {
    return (
      <PracticeHistoryScreen
        displayName={displayName}
        historyError={historyError}
        sessions={history}
        reportForSession={reportForSession}
        onOpen={openSession}
      />
    );
  }

  if (step === "video") {
    return (
      <PracticeNewScreen
        error={error}
        busy={busy}
        onUploadFileSelect={selectUploadFile}
      />
    );
  }

  return (
    <PracticeContextScreen
      file={file}
      previewUrl={previewUrl}
      situation={situation}
      characterContext={characterContext}
      subtext={subtext}
      busy={busy}
      uploadProgress={uploadProgress}
      error={error}
      onBack={returnToVideoSelection}
      onSituationChange={setSituation}
      onCharacterContextChange={setCharacterContext}
      onSubtextChange={setSubtext}
      onSubmit={begin}
    />
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-3 text-base font-black text-[#333d4b]">
      <span className="flex items-center gap-2">{label} <RequiredBadge /></span>
      <textarea
        className="min-h-28 rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function LoadingScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7faff] px-5 py-10 text-[#191f28]">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-8 text-center shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
        <span className="mx-auto"><AppLogoMark /></span>
        <p className="mt-5 text-base font-bold leading-7 text-[#4e5968]">{message}</p>
        {onRetry ? (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button type="button" onClick={onRetry} className="min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">
              다시 확인하기
            </button>
            <Link href="/home" className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-5 py-3 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">
              홈으로
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function PracticeHome({
  displayName,
  historyError,
  sessions,
  reportForSession,
  onLogout,
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  sessions: PracticeSessionListItem[];
  reportForSession: (sessionId: string) => ReportRecord | undefined;
  onLogout: () => void | Promise<void>;
  onOpen: (session: PracticeSessionListItem) => void;
}) {
  return (
    <div className="min-h-dvh bg-white text-[#191f28]">
      <header className="flex h-15 items-center gap-3 border-b border-[#edf0f3] bg-white/90 px-5 backdrop-blur">
        <Image src={wordmark} alt="Acttub" priority className="h-5 w-auto shrink-0" />
        <div className="ml-auto flex items-center gap-3 text-[13px] text-[#4e5968]">
          <span className="font-black tracking-[-0.02em]">{displayName}</span>
          <button type="button" onClick={() => void onLogout()} className="font-semibold text-[#8b95a1] transition hover:text-[#191f28]">로그아웃</button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[920px] px-5 pb-16 pt-10">
        <h1 className="text-xl font-black leading-tight tracking-[-0.05em] sm:text-[34px]">{displayName}님, 오늘도 같이 연습해 볼까요?</h1>

        {/* 카드 전체가 버튼이다 — 안에 따로 버튼을 두면 폰에서 눌러야 할 곳이 두 군데로 갈린다 */}
        <Link
          href="/practice/new"
          className="mt-6 flex items-center justify-between gap-4 rounded-[24px] bg-[linear-gradient(120deg,#eaf6ff,#f8fbff)] p-5 shadow-[0_16px_45px_rgba(25,31,40,0.06)] transition hover:-translate-y-0.5 sm:px-7 sm:py-6"
        >
          <span className="min-w-0">
            <span className="block text-base font-black tracking-[-0.03em] sm:text-lg">새 연습 시작하기</span>
            <span className="mt-1 block text-xs font-semibold text-[#4e5968] sm:text-[13px]">오늘 찍은 장면을 올리고 질문을 받아보세요.</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-lg font-black text-[#3182f6]">→</span>
        </Link>

        <div className="mb-3.5 mt-10 flex items-center justify-between">
          <h2 className="text-lg font-black tracking-[-0.03em]">내 연습 기록</h2>
          <Link href="/practice/history" className="text-[13px] font-black text-[#8b95a1] transition hover:text-[#191f28]">전체 보기</Link>
        </div>

        {historyError ? (
          <p className="rounded-[24px] bg-[#fff8ec] px-6 py-5 text-sm font-bold text-[#8a4b00]">연습 기록을 잠시 불러오지 못했어요. 새 연습은 바로 시작할 수 있어요.</p>
        ) : sessions.length === 0 ? (
          <div className="rounded-[24px] bg-[#f8fbff] px-6 py-11 text-center">
            <div className="text-[15px] font-black tracking-[-0.02em]">아직 연습 기록이 없어요</div>
            <div className="mt-2 text-[13px] font-semibold text-[#4e5968]">첫 영상을 올리면 이곳에 장면별 연습 기록이 쌓입니다.</div>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((s) => {
              const hasReport = Boolean(reportForSession(s.session_id));
              // min-w-0: 없으면 카드가 제목 길이만큼 벌어져 좁은 화면에서 화면 밖으로 나간다
              return (
                <button key={s.session_id} type="button" onClick={() => onOpen(s)} className="flex w-full min-w-0 items-center gap-3.5 rounded-[20px] bg-white p-4 text-left shadow-[0_16px_45px_rgba(25,31,40,0.06)] transition hover:-translate-y-0.5">
                  <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#0b1220,#1b2942)] text-[11px] font-black text-[#8fb4ff]">▶</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black tracking-[-0.02em]">{s.situation || "연습"}</span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-[#8b95a1]">{s.character_context || "장면 기록"}</span>
                  </span>
                  <span className="shrink-0 text-xs font-black text-[#3182f6]">{hasReport ? "연습 노트 다시 보기 →" : "이어보기 →"}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function PracticeNewScreen({
  error,
  busy,
  onUploadFileSelect,
}: {
  error: string | null;
  busy: boolean;
  onUploadFileSelect: (file: File | null) => void;
}) {
  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[960px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
              <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                새 연습
              </p>
            </div>
            <h1 className="mt-5 text-2xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              오늘의 연기 영상을 올려 주세요
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              영상을 고른 다음 장면과 인물의 맥락을 차근차근 입력할 수 있어요.
            </p>
          </div>
          <Link
            href="/home"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
          >
            홈으로
          </Link>
        </header>

        {error ? <ErrorNotice message={error} /> : null}
        <VideoDropZone busy={busy} onUploadFileSelect={onUploadFileSelect} />
      </div>
    </main>
  );
}

function PracticeHistoryScreen({
  displayName,
  historyError,
  sessions,
  reportForSession,
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  sessions: PracticeSessionListItem[];
  reportForSession: (sessionId: string) => ReportRecord | undefined;
  onOpen: (session: PracticeSessionListItem) => void;
}) {
  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
              <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                연습 기록
              </p>
            </div>
            <h1 className="mt-5 text-2xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              {displayName}님의 전체 연습
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              장면별 진행 상태와 완성된 연습 노트를 한곳에서 확인할 수 있어요.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/home" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">
              홈
            </Link>
            <Link href="/practice/new" className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2f6bff] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]">
              새 연습
            </Link>
          </div>
        </header>
        <RecentPracticeSection
          error={historyError}
          sessions={sessions}
          reportForSession={reportForSession}
          onOpen={onOpen}
          variant="full"
        />
      </div>
    </main>
  );
}

function PracticeContextScreen({
  file,
  previewUrl,
  situation,
  characterContext,
  subtext,
  busy,
  uploadProgress,
  error,
  onBack,
  onSituationChange,
  onCharacterContextChange,
  onSubtextChange,
  onSubmit,
}: {
  file: File | null;
  previewUrl: string | null;
  situation: string;
  characterContext: string;
  subtext: string;
  busy: boolean;
  uploadProgress: UploadProgressState | null;
  error: string | null;
  onBack: () => void;
  onSituationChange: (value: string) => void;
  onCharacterContextChange: (value: string) => void;
  onSubtextChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <main className="min-h-dvh bg-[#f8fafc] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]"
        >
          ← 영상 다시 선택
        </button>

        <header className="mt-6 rounded-[28px] bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black text-[#2f6bff]">2단계 · 장면 맥락</p>
          <h1 className="mt-3 text-2xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
            이 장면에서 무엇을 연기했는지 알려 주세요
          </h1>
          <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
            입력한 장면과 인물 정보는 영상 분석과 인터뷰 질문의 기준이 됩니다.
          </p>
        </header>

        {error ? <ErrorNotice message={error} /> : null}

        <section className="mt-6 grid gap-4 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[#eaf2ff] text-[#2f6bff]">
              <UploadIcon />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black text-[#8b95a1]">선택된 영상</p>
              <p className="mt-1 truncate text-lg font-black tracking-[-0.04em]">
                {file?.name ?? "파일을 다시 선택해 주세요"}
              </p>
              {file ? <p className="mt-1 text-sm font-bold text-[#b0b8c1]">{formatFileSize(file.size)}</p> : null}
              {uploadProgress !== null ? (
                <p className="mt-2 text-sm font-black text-[#2f6bff]">
                  {uploadProgress.stage === "compressing" ? "압축 중" : "업로드 중"}… {uploadProgress.percent}%
                </p>
              ) : null}
            </div>
          </div>
          <SelectedUploadPreview file={file} previewUrl={previewUrl} />
        </section>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <SceneContextForm
            situation={situation}
            characterContext={characterContext}
            subtext={subtext}
            onSituationChange={onSituationChange}
            onCharacterContextChange={onCharacterContextChange}
            onSubtextChange={onSubtextChange}
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_2fr]">
            <button type="button" disabled={busy} onClick={onBack} className="min-h-12 rounded-2xl border border-[#d1d6db] bg-white px-5 py-3 font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]">
              다른 영상 선택
            </button>
            <button type="submit" disabled={busy || !file} className="min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
              {uploadProgress !== null
                ? `${uploadProgress.stage === "compressing" ? "압축 중" : "업로드 중"}… ${uploadProgress.percent}%`
                : busy
                  ? "업로드하고 분석하는 중…"
                  : "입력 완료하고 분석 시작"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function SceneContextForm({
  situation,
  characterContext,
  subtext,
  onSituationChange,
  onCharacterContextChange,
  onSubtextChange,
}: {
  situation: string;
  characterContext: string;
  subtext: string;
  onSituationChange: (value: string) => void;
  onCharacterContextChange: (value: string) => void;
  onSubtextChange: (value: string) => void;
}) {
  return (
    <section className="mt-6 grid gap-6 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm sm:p-7">
      <TextField label="상황" value={situation} onChange={onSituationChange} />
      <TextField label="인물 정보" value={characterContext} onChange={onCharacterContextChange} />
      <TextField label="서브텍스트" value={subtext} onChange={onSubtextChange} />
    </section>
  );
}

function VideoDropZone({
  busy,
  onUploadFileSelect,
}: {
  busy: boolean;
  onUploadFileSelect: (file: File | null) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!busy) onUploadFileSelect(event.dataTransfer.files?.[0] ?? null);
  }

  return (
    <label
      onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
      onDrop={handleDrop}
      className={
        "group mt-8 flex min-h-[260px] items-center justify-center rounded-[24px] border-2 border-dashed px-4 py-8 text-center transition sm:min-h-[320px] " +
        (dragActive
          ? "border-[#3182f6] bg-[#eef6ff]"
          : "border-[#c8d9f7] bg-[#f7faff] hover:border-[#3182f6] hover:bg-[#f3f8ff]") +
        (busy ? " cursor-wait" : " cursor-pointer")
      }
    >
      <input
        type="file"
        accept="video/mp4,video/quicktime"
        disabled={busy}
        onChange={(event) => onUploadFileSelect(event.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <span className="flex flex-col items-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[#eaf2ff] text-[#2f6bff]">
          <UploadIcon />
        </span>
        <span className="mt-5 block text-xl font-black tracking-[-0.04em] sm:text-2xl">
          여기로 연습 영상을 끌어다 놓으세요
        </span>
        <span className="mt-2 block text-base font-bold text-[#b0b8c1]">또는</span>
        <span className="mt-4 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-7 text-lg font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition group-hover:bg-[#1b64da]">
          {busy ? "업로드 준비 중" : "파일 선택하기"}
        </span>
        <span className="mt-4 block text-sm font-bold tracking-[0.02em] text-[#b0b8c1] sm:text-base">
          MP4 · MOV · 5분 이내
        </span>
      </span>
    </label>
  );
}

function SelectedUploadPreview({ file, previewUrl }: { file: File | null; previewUrl: string | null }) {
  const [previewError, setPreviewError] = useState(false);

  if (!file || !previewUrl) {
    return <div className="flex aspect-video items-center justify-center rounded-2xl bg-[#f2f4f6] text-sm font-bold text-[#8b95a1]">미리보기 대기</div>;
  }

  if (previewError) {
    return <div className="flex aspect-video items-center justify-center rounded-2xl bg-red-50 px-5 text-center text-sm font-bold leading-6 text-red-600">이 브라우저에서 선택한 영상을 재생할 수 없어요.</div>;
  }

  return (
    <video
      key={previewUrl}
      controls
      preload="metadata"
      className="aspect-video w-full rounded-2xl bg-[#111827] object-contain"
      src={previewUrl}
      onError={() => setPreviewError(true)}
    >
      선택한 영상을 미리 볼 수 없어요.
    </video>
  );
}

function RecentPracticeSection({
  error,
  sessions,
  reportForSession,
  onOpen,
  variant = "recent",
}: {
  error?: string | null;
  sessions: PracticeSessionListItem[];
  reportForSession: (sessionId: string) => ReportRecord | undefined;
  onOpen: (session: PracticeSessionListItem) => void;
  variant?: "recent" | "full";
}) {
  const visibleSessions = variant === "full" ? sessions : sessions.slice(0, 3);

  return (
    <section className="mt-10 pb-10">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-black tracking-[-0.05em]">{variant === "full" ? "전체 연습 기록" : "최근 연습"}</h2>
        {variant === "recent" && sessions.length > 0 ? <Link href="/practice/history" className="text-base font-black text-[#2f6bff] transition hover:text-[#1b64da]">전체 보기</Link> : null}
      </header>

      {error ? (
        <div role="alert" className="mt-5 rounded-[24px] border border-[#ffd8a8] bg-[#fff8ec] p-6">
          <p className="text-lg font-black text-[#8a4b00]">연습 기록을 불러오지 못했어요</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8a4b00]">{error}</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8a4b00]">새 연습은 계속 시작할 수 있어요.</p>
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="mt-5 rounded-[24px] border border-dashed border-[#c8d9f7] bg-[#f7faff] p-8 text-center">
          <p className="text-xl font-black tracking-[-0.04em]">아직 연습 기록이 없어요</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8b95a1]">첫 영상을 올리면 이곳에 장면별 연습 기록이 쌓입니다.</p>
          <Link href="/practice/new" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">첫 연습 시작하기</Link>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSessions.map((session) => (
            <PracticeHistoryCard
              key={session.session_id}
              session={session}
              report={reportForSession(session.session_id)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PracticeHistoryCard({
  session,
  report,
  onOpen,
}: {
  session: PracticeSessionListItem;
  report?: ReportRecord;
  onOpen: (session: PracticeSessionListItem) => void;
}) {
  const badge = getPracticeBadge(session, report);
  const content = (
    <>
      <div className="relative flex aspect-[2.78/1] items-center justify-center bg-[#1f2937]" style={{ backgroundImage: "repeating-linear-gradient(45deg, #202938 0 22px, #182131 22px 44px)" }}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#191f28] shadow-sm"><PlayIcon /></span>
      </div>
      <div className="px-5 py-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black tracking-[-0.04em]">{session.situation || "연기 연습"}</h3>
            <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-[#8b95a1]">{report?.report.headline ?? session.situation}</p>
          </div>
          <span className={"shrink-0 rounded-full px-3 py-1.5 text-xs font-black " + (badge.positive ? "bg-[#e5f8ef] text-[#009959]" : "bg-[#f2f4f6] text-[#4e5968]")}>{badge.label}</span>
        </div>
        <p className="mt-4 text-sm font-bold text-[#b0b8c1]">{formatRelativePracticeDate(session.updated_at)}</p>
      </div>
    </>
  );

  const className = "overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(25,31,40,0.08)]";
  return <button type="button" className={className} onClick={() => onOpen(session)}>{content}</button>;
}

function AppLogoMark() {
  return <Image src={wordmark} alt="Acttub" priority className="h-6 w-auto shrink-0" />;
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
      <path d="M24 33V11m0 0-8 8m8-8 8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
      <path d="M12 31v4a6 6 0 0 0 6 6h12a6 6 0 0 0 6-6v-4" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function PlayIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5L8 5.5Z" /></svg>;
}

function RequiredBadge() {
  return <span className="rounded-full bg-[#eaf2ff] px-2 py-0.5 text-xs font-black text-[#2f6bff]">필수</span>;
}

function ErrorNotice({ message }: { message: string }) {
  return <p role="alert" className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold leading-6 text-red-600">{message}</p>;
}

function formatDisplayName(user: AuthUser | null): string {
  const email = user?.email;
  if (!email) return "배우";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "배우";
}

function getPracticeBadge(
  session: PracticeSessionListItem,
  report?: ReportRecord,
): { label: string; positive: boolean } {
  if (report) return { label: "완료", positive: true };
  if (session.status === "analyzed") return { label: "인터뷰 가능", positive: false };
  if (session.status === "failed") return { label: "분석 실패", positive: false };
  return { label: "분석 중", positive: false };
}

function formatRelativePracticeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return String(diffDays) + "일 전";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return String(Math.max(1, Math.round(sizeBytes / 1024))) + "KB";
  return (sizeBytes / (1024 * 1024)).toFixed(1) + "MB";
}

function SessionView({
  session,
  phase,
  coach,
  reportData,
  reportTurns,
  answer,
  pendingAnswer,
  busy,
  coachWaiting,
  error,
  setAnswer,
  onStartCoach,
  onReply,
  onRetryAnalysis,
  onCreateReport,
  onPlaybackError,
  onRefreshSession,
}: {
  session: PracticeSessionDetail;
  phase: Phase;
  coach: CoachState | null;
  reportData: ReportData | null;
  reportTurns: CoachTurn[];
  answer: string;
  pendingAnswer: string | null;
  busy: boolean;
  coachWaiting: boolean;
  error: string | null;
  setAnswer: (value: string) => void;
  onStartCoach: () => void;
  onReply: () => void;
  onRetryAnalysis: () => void;
  onCreateReport: () => void;
  onPlaybackError: () => void;
  onRefreshSession: () => void;
}) {
  const analysisPending = session.status === "created" || session.status === "analyzing";

  return (
    <main className="min-h-dvh bg-[#f8fafc] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
            </div>
            <h1 className="mt-5 text-2xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">{session.situation}</h1>
            <p className="mt-3 max-w-2xl font-semibold leading-7 text-[#6b7684]">{session.character_context}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={SESSION_DETAIL_PATH} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">← 연습 기록</Link>
            <Link href="/home" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">홈</Link>
          </div>
        </header>

        {analysisPending ? (
          <AnalysisPending
            status={session.status === "created" ? "created" : "analyzing"}
            error={error}
            onRetry={onRefreshSession}
          />
        ) : null}
        {session.status === "failed" ? (
          <AnalysisFailed errorCode={session.error_code} busy={busy} onRetry={onRetryAnalysis} />
        ) : null}
        {session.status === "analyzed" && phase === "summary" ? (
          <SummaryView session={session} onPlaybackError={onPlaybackError} />
        ) : null}
        {session.status === "analyzed" && phase === "coaching" ? (
          <CoachingView
            coach={coach}
            answer={answer}
            pendingAnswer={pendingAnswer}
            busy={busy}
            coachWaiting={coachWaiting}
            error={error}
            setAnswer={setAnswer}
            onStartCoach={onStartCoach}
            onReply={onReply}
            onCreateReport={onCreateReport}
          />
        ) : null}
        {session.status === "analyzed" && phase === "report" ? (
          <Report reportData={reportData} turns={reportTurns} busy={busy} onCreateReport={onCreateReport} />
        ) : null}
        {error && phase !== "coaching" && !analysisPending ? <ErrorNotice message={error} /> : null}
      </div>
    </main>
  );
}

function AnalysisPending({
  status,
  error,
  onRetry,
}: {
  status: "created" | "analyzing";
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-live="polite" className="mt-8 overflow-hidden rounded-[28px] border border-[#dce9ff] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
      <div className="bg-[#f7faff] p-6 sm:p-8">
        <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">영상 분석</span>
        <h2 className="mt-4 text-xl font-black tracking-[-0.04em] sm:text-3xl">
          {status === "created" ? "분석을 준비하고 있어요" : "장면을 분석하고 있어요"}
        </h2>
        <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#6b7684]">영상 속 행동과 장면 정보를 안전하게 정리하는 중이에요.</p>
        {error ? (
          <div className="mt-6 rounded-2xl border border-[#ffd8a8] bg-[#fff8ec] p-5">
            <p className="font-bold leading-7 text-[#8a4b00]">{error}</p>
            <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-xl bg-[#9a5b00] px-4 text-sm font-black text-white transition hover:bg-[#7a4800]">
              상태 다시 확인하기
            </button>
          </div>
        ) : (
          <div className="mt-7 h-3 overflow-hidden rounded-full bg-[#dce9ff]">
            <div className="h-full w-3/4 animate-pulse rounded-full bg-[#3182f6]" />
          </div>
        )}
      </div>
    </section>
  );
}

function AnalysisFailed({
  errorCode,
  busy,
  onRetry,
}: {
  errorCode: PracticeSessionDetail["error_code"];
  busy: boolean;
  onRetry: () => void;
}) {
  const failure = analysisFailure(errorCode);
  return (
    <section className="mt-8 rounded-[28px] border border-[#ffd8a8] bg-[#fff8ec] p-6 shadow-[0_14px_40px_rgba(25,31,40,0.05)] sm:p-8">
      <span className="inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#9a5b00]">분석 중단</span>
      <h2 className="mt-4 text-xl font-black tracking-[-0.04em] text-[#8a4b00]">분석을 완료하지 못했어요</h2>
      <p className="mt-3 font-bold leading-7 text-[#8a4b00]">{failure.message}</p>
      {failure.retryable ? (
        <button type="button" disabled={busy} onClick={onRetry} className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
          {busy ? "다시 분석하는 중…" : "분석 다시 시도"}
        </button>
      ) : (
        <Link href="/practice/new" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#191f28] px-5 py-3 text-sm font-black text-white transition hover:bg-[#333d4b]">새 연습 시작하기</Link>
      )}
    </section>
  );
}

function SummaryView({
  session,
  onPlaybackError,
}: {
  session: PracticeSessionDetail;
  onPlaybackError: () => void;
}) {
  const summary = session.summary;

  return (
    <section className="mt-8 grid gap-5">
      <div className="overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
        <div className="p-5 sm:p-6">
          <span className="inline-flex rounded-full bg-[#e5f8ef] px-3 py-1.5 text-xs font-black text-[#009959]">분석 완료</span>
          <h2 className="mt-4 text-xl font-black tracking-[-0.04em] sm:text-3xl">장면에서 보인 단서를 정리했어요</h2>
          <p className="mt-3 font-semibold leading-7 text-[#6b7684]">분석은 정답이 아니라 다음 질문을 위한 관찰이에요.</p>
        </div>
        <video key={session.playback_url} controls preload="metadata" src={session.playback_url} onError={onPlaybackError} className="aspect-video w-full bg-[#111827] object-contain">
          분석한 영상을 재생할 수 없어요.
        </video>
      </div>

      {summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {summary.summary?.trim() ? <SummarySection title="장면 요약" body={summary.summary} wide /> : null}
            {summary.intent_alignment?.trim() ? <SummarySection title="의도 일치" body={summary.intent_alignment} /> : null}
            {summary.key_moment?.trim() ? <SummarySection title="핵심 순간" body={summary.key_moment} tone="blue" /> : null}
            {summary.key_dimension?.trim() ? <SummarySection title="핵심 차원" body={summary.key_dimension} /> : null}
          </div>

          {/* 관찰 기록과 특이점은 내부 산출물이라 배우에게 노출하지 않는다 (제품 가드레일).
              질문 대화의 근거로만 쓰고 화면에는 그리지 않는다. */}

          {/* 같은 장면을 다시 찍어 보게, 적었던 맥락만 새 연습으로 넘긴다 (영상은 새로 올린다) */}
          <Link
            href={`/practice/new?from=${encodeURIComponent(session.session_id)}`}
            className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#2f6bff] px-6 py-3 text-base font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da]"
          >
            인터뷰 다시하기
          </Link>
        </>
      ) : (
        <p className="rounded-2xl bg-[#fff8ec] p-5 font-bold leading-7 text-[#8a4b00]">분석 요약을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
      )}
    </section>
  );
}

function CoachingView({
  coach,
  answer,
  pendingAnswer,
  busy,
  coachWaiting,
  error,
  setAnswer,
  onStartCoach,
  onReply,
  onCreateReport,
}: {
  coach: CoachState | null;
  answer: string;
  pendingAnswer: string | null;
  busy: boolean;
  coachWaiting: boolean;
  error: string | null;
  setAnswer: (value: string) => void;
  onStartCoach: () => void;
  onReply: () => void;
  onCreateReport: () => void;
}) {
  if (!coach) {
    return (
      <section aria-live="polite" className="mt-8 rounded-[28px] border border-[#dce9ff] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
        <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">AI 코칭</span>
        <h2 className="mt-4 text-xl font-black tracking-[-0.04em]">AI 코치가 첫 질문을 준비하고 있어요</h2>
        <p className="mt-3 font-bold leading-7 text-[#6b7684]">{coachWaiting ? "코치가 생각 중이에요…" : "분석 내용을 질문으로 바꾸고 있어요."}</p>
        {!busy && error ? (
          <button type="button" onClick={onStartCoach} className="mt-6 min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">코칭 시작 다시 시도</button>
        ) : null}
        {error ? <ErrorNotice message={error} /> : null}
      </section>
    );
  }

  const currentQuestion = [...coach.turns]
    .reverse()
    .find((turn) => turn.role === "coach");
  const currentFocusTimestamp = currentQuestion?.focusTimestamp?.trim();

  return (
    <section className="mt-8 overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
      <header className="flex items-center justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-xs font-black text-white">AI</span>
          <div>
            <h2 className="font-black tracking-[-0.03em]">현재 장면을 바탕으로 질문하고 있어요</h2>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">질문 {Math.min(coach.questionCount, 10)}/10</span>
      </header>

      {currentQuestion ? (
        <article className="border-b border-[#e5e8eb] bg-[#f7faff] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black text-[#2f6bff]">현재 질문</p>
            {currentFocusTimestamp ? (
              <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-[#2f6bff] shadow-sm">
                {currentFocusTimestamp} 구간
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-lg font-black leading-8 tracking-[-0.025em]">{currentQuestion.text}</p>
        </article>
      ) : null}

      <div role="log" aria-live="polite" aria-label="AI 코치와 나눈 대화" className="min-h-[320px] max-h-[560px] space-y-4 overflow-y-auto bg-[#f7f8fa] px-4 py-5 sm:px-6">
        {coach.turns.map((turn, index) => <ConversationBubble key={turn.role + "-" + String(index)} turn={turn} />)}
        {pendingAnswer ? (
          <div data-message-id="pending-answer" className="flex items-end justify-end gap-2">
            <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[#3182f6] px-4 py-3 text-white shadow-sm">
              <p className="text-xs font-black opacity-70">나</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">{pendingAnswer}</p>
            </div>
          </div>
        ) : null}
        {coachWaiting ? (
          <div className="flex items-end gap-2">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span>
            <p className="rounded-2xl rounded-bl-md border border-[#e5e8eb] bg-white px-4 py-3 text-sm font-bold text-[#8b95a1] shadow-sm">코치가 생각 중이에요…</p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[#e5e8eb] bg-white p-4 sm:p-5">
        {coach.done ? (
          <div className="rounded-2xl border border-[#dce9ff] bg-[#f7faff] p-5">
            <p className="text-xs font-black text-[#2f6bff]">코칭 완료</p>
            <h3 className="mt-2 text-xl font-black tracking-[-0.035em]">{coachDoneMessage(coach.reason)}</h3>
            <p className="mt-2 font-semibold leading-7 text-[#6b7684]">대화를 바탕으로 이번 연기의 핵심을 연습 노트로 정리해 보세요.</p>
            <button type="button" disabled={busy} onClick={onCreateReport} className="mt-5 min-h-12 w-full rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff] sm:w-auto">
              {busy ? "연습 노트를 만드는 중…" : "연습 노트 만들기"}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <textarea
                aria-label="답변"
                rows={3}
                className="min-h-24 flex-1 resize-y rounded-2xl border border-[#d1d6db] bg-white p-4 text-[15px] font-semibold leading-6 outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff] disabled:bg-[#f2f4f6]"
                value={answer}
                disabled={busy || coachWaiting}
                placeholder="질문을 듣고 떠오른 생각을 편하게 적어 주세요."
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && answer.trim() && !busy && !coachWaiting) {
                    event.preventDefault();
                    onReply();
                  }
                }}
              />
              <button type="button" disabled={busy || coachWaiting || !answer.trim()} onClick={onReply} className="min-h-12 shrink-0 rounded-2xl bg-[#2f6bff] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
                {busy || coachWaiting ? "보내는 중…" : "답변 보내기"}
              </button>
            </div>
            <p className="mt-3 text-center text-xs font-bold text-[#8b95a1]">&apos;그만&apos;, &apos;종료&apos;, &apos;끝&apos;을 입력하면 인터뷰를 마칠 수 있어요.</p>
          </>
        )}
        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </section>
  );
}

function ConversationBubble({ turn }: { turn: CoachTurn }) {
  const actor = turn.role === "actor";
  const focusTimestamp = turn.focusTimestamp?.trim();
  return (
    <div className={"flex items-end gap-2 " + (actor ? "justify-end" : "justify-start")}>
      {!actor ? <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span> : null}
      <div className={"max-w-[82%] rounded-2xl px-4 py-3 shadow-sm " + (actor ? "rounded-br-md bg-[#3182f6] text-white" : "rounded-bl-md border border-[#e5e8eb] bg-white text-[#191f28]")}>
        <p className="text-xs font-black opacity-70">{actor ? "나" : "AI 코치"}</p>
        {focusTimestamp ? (
          <span className={"mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-black " + (actor ? "bg-white/15 text-white" : "bg-[#eaf2ff] text-[#2f6bff]")}>{focusTimestamp} 구간</span>
        ) : null}
        <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">{turn.text}</p>
      </div>
    </div>
  );
}

function Report({
  reportData,
  turns,
  busy,
  onCreateReport,
}: {
  reportData: ReportData | null;
  turns: CoachTurn[];
  busy: boolean;
  onCreateReport: () => void;
}) {
  if (!reportData) {
    return (
      <section className="mt-8 rounded-[28px] border border-[#dce9ff] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
        <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">코칭 완료</span>
        <h2 className="mt-3 text-lg font-black tracking-[-0.04em] sm:mt-4 sm:text-3xl">{busy ? "연습 노트를 만들고 있어요" : "연습 노트를 만들어 보세요"}</h2>
        <p className="mt-2.5 max-w-2xl text-sm font-bold leading-6 text-[#6b7684] sm:mt-3 sm:text-base sm:leading-7">나눈 대화를 바탕으로 다음 연습에 가져갈 한 문장을 정리해요.</p>
        {!busy ? <button type="button" onClick={onCreateReport} className="mt-6 min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">연습 노트 만들기</button> : null}
      </section>
    );
  }

  const report = reportData.report;
  return (
    <section className="mt-8 grid gap-4">
      <header className="rounded-[28px] bg-[#2f6bff] p-5 text-white shadow-[0_16px_36px_rgba(49,130,246,0.2)] sm:p-8">
        <p className="text-xs font-black text-white/75 sm:text-sm">{reportData.reportCount}번째 연습 노트</p>
        <h2 className="mt-2 text-lg font-black leading-snug tracking-[-0.04em] sm:mt-3 sm:text-4xl">{report.headline}</h2>
      </header>
      <article className="rounded-[24px] border border-[#dce9ff] bg-[#f7faff] p-4 sm:p-6">
        <p className="text-xs font-black text-[#2f6bff]">다시 본 순간</p>
        <h3 className="mt-2 text-base font-black tracking-[-0.035em] sm:text-xl">영상에서 눈에 남은 곳</h3>
        <p className="mt-3 inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#4e5968] sm:text-sm">
          {report.biggest_problem.start}–{report.biggest_problem.end}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#333d4b] sm:mt-4 sm:text-base sm:leading-7">{report.biggest_problem.description}</p>
      </article>
      <div className="grid gap-4 md:grid-cols-2">
        <ReportSection title="장면에서 찾은 근거" body={report.evidence} />
        <ReportSection title="스스로 발견한 점" body={report.self_discovery} />
        <ReportSection title="다음 연습" body={report.next_step} tone="action" wide />
      </div>
      {turns.length > 0 ? (
        <section className="overflow-hidden rounded-[24px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.035)]">
          <div className="border-b border-[#e5e8eb] px-4 py-3.5 sm:px-6 sm:py-4">
            <p className="text-xs font-black text-[#2f6bff]">코칭 대화</p>
            <h3 className="mt-1 text-base font-black tracking-[-0.035em] sm:text-lg">함께 찾은 생각</h3>
          </div>
          <div role="log" aria-label="완료된 AI 코칭 대화" className="max-h-[480px] space-y-4 overflow-y-auto bg-[#f7f8fa] px-4 py-5 sm:px-6">
            {turns.map((turn, index) => <ConversationBubble key={"report-" + turn.role + "-" + String(index)} turn={turn} />)}
          </div>
        </section>
      ) : null}
      <aside className="rounded-[24px] border border-[#dce9ff] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div>
          <h3 className="text-base font-black tracking-[-0.035em] sm:text-lg">이번 연습은 어떠셨나요?</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968] sm:text-base sm:leading-7">짧은 설문으로 경험을 알려 주시면 더 나은 연기 코치를 만드는 데 활용할게요.</p>
        </div>
        <a href="https://acttub.github.io/review-form/" target="_blank" rel="noopener noreferrer" aria-label="세션 후기 설문조사 참여하기 (새 창)" className="mt-5 inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] sm:mt-0">설문조사 참여하기 ↗</a>
      </aside>
    </section>
  );
}

function SummarySection({
  title,
  body,
  tone = "default",
  wide = false,
}: {
  title: string;
  body: string;
  tone?: "default" | "blue";
  wide?: boolean;
}) {
  return (
    <article className={(wide ? "md:col-span-2 " : "") + "rounded-[24px] border p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:p-6 " + (tone === "blue" ? "border-[#dce9ff] bg-[#f7faff]" : "border-[#e5e8eb] bg-white")}>
      <h3 className="text-base font-black tracking-[-0.035em] sm:text-lg">{title}</h3>
      <p className="mt-2.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4e5968] sm:mt-3 sm:text-base sm:leading-7">{body}</p>
    </article>
  );
}

function ReportSection({
  title,
  body,
  tone = "default",
  wide = false,
}: {
  title: string;
  body: string;
  tone?: "default" | "positive" | "action";
  wide?: boolean;
}) {
  const toneClass = tone === "positive"
    ? "border-[#c9efdc] bg-[#f0fbf6]"
    : tone === "action"
      ? "border-[#dce9ff] bg-[#f7faff]"
      : "border-[#e5e8eb] bg-white";

  return (
    <article className={(wide ? "md:col-span-2 " : "") + "rounded-[24px] border p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:p-6 " + toneClass}>
      <h3 className="text-base font-black tracking-[-0.035em] sm:text-lg">{title}</h3>
      <p className="mt-2.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4e5968] sm:mt-3 sm:text-base sm:leading-7">{body}</p>
    </article>
  );
}

function analysisFailure(errorCode: PracticeSessionDetail["error_code"]): {
  message: string;
  retryable: boolean;
} {
  switch (errorCode) {
    case "gemini_timeout":
      return { message: "분석 시간이 초과됐어요. 같은 영상으로 다시 시도할 수 있어요.", retryable: true };
    case "gemini_parse_error":
      return { message: "분석 결과를 정리하지 못했어요. 다시 시도해 주세요.", retryable: true };
    case "unsupported_media":
      return { message: "이 영상 형식은 분석할 수 없어요. 다른 영상으로 새 연습을 시작해 주세요.", retryable: false };
    case "max_attempts_exceeded":
      return { message: "재시도 한도를 모두 사용했어요. 새 연습을 시작해 주세요.", retryable: false };
    default:
      return { message: "영상 분석을 완료하지 못했어요. 같은 영상으로 다시 시도해 주세요.", retryable: true };
  }
}

function coachDoneMessage(reason: CoachState["reason"]): string {
  switch (reason) {
    case "gap_stated":
      return "핵심 지점을 찾았어요";
    case "exhausted":
      return "이 장면에서 나눌 질문을 충분히 살펴봤어요";
    case "limit":
      return "최대 10개 질문에 도달했어요";
    case "user_ended":
      return "인터뷰를 마무리했어요";
    default:
      return "인터뷰를 마무리했어요";
  }
}

