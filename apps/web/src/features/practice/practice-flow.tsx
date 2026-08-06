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
import { getReport, listReports } from "@/lib/api/v2/reports";
import {
  createPracticeSession,
  deletePracticeSession,
  getPracticeSession,
  pollSessionUntilSettled,
} from "@/lib/api/v2/sessions";
import type {
  AuthUser,
  PracticeReport,
  PracticeSessionDetail,
  ReportRecord,
} from "@/lib/api/v2/types";
import { UploadError, uploadVideo } from "@/lib/api/v2/uploads";
import { logout } from "@/lib/api/v2/auth";
import { REVIEW_FORM_URL } from "@/lib/config/env";
import { prepareVideoUpload } from "@/lib/media/upload-preflight";
import { PracticeReportCards } from "@/features/practice/practice-report-cards";
import {
  coachMessageText,
  completedCoachReport,
  createCoachStartCoordinator,
  isCoachInputEnabled,
  type CoachStartCoordinator,
} from "@/features/practice/coach-contract";
import { BlockageSelectionFlow } from "@/features/practice/blockage-selection";
import type { BlockageSelection } from "@/features/practice/blockage-flow";
import { WaitingDots } from "@/features/practice/waiting-dots";
import {
  buildPracticeSessionRequest,
  submitSceneContext,
} from "@/features/practice/practice-setup-flow";

type Entry = "home" | "new" | "history";
type Step = "home" | "history" | "video" | "context" | "blockage";
type Phase = "coaching" | "report";
type CoachTurn = {
  role: "coach" | "actor";
  text: string;
};
type CoachState = {
  coachSessionId: string;
  turns: CoachTurn[];
  questionCount: number;
  done: boolean;
};
type ReportData = { report: PracticeReport; reportCount: number };

// 코치 응답 예산. 정본은 apps/api 의 acting_agent/prompt.py TURN_BUDGET 이다.
const TURN_BUDGET = 8;
type ResolvedReport = { record: ReportRecord; ordinal: number };
type UploadProgressState = {
  percent: number;
  stage: "compressing" | "uploading";
};

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
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [active, setActive] = useState<{ sessionId: string } | null>(null);
  const [sessionDetail, setSessionDetail] = useState<PracticeSessionDetail | null>(null);
  const [phase, setPhase] = useState<Phase>("coaching");
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [situation, setSituation] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [goal, setGoal] = useState("");
  const [answer, setAnswer] = useState("");
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coachWaiting, setCoachWaiting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // 지금 화면에 열려 있는 세션. 코치 요청은 취소할 수 없으므로, 늦게 도착한 응답이
  // 이미 다른 세션으로 옮겨간 화면을 덮지 않도록 이 값과 대조한다.
  const activeSessionRef = useRef<string | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const playbackRefreshAttemptedRef = useRef(false);
  const coachCoordinatorRef = useRef<{
    sessionId: string;
    coordinator: CoachStartCoordinator;
  } | null>(null);

  // 배우가 정한 호칭. 묻는 건 첫 로그인 때 로그인 화면에서 하고, 여기서는 읽기만 한다.
  const [storedName, setStoredName] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 localStorage 확인 (서버 렌더와 값이 달라 초기값으로 못 읽는다)
    setStoredName(getStoredDisplayName());
  }, []);

  // 주소의 ?session=<id>가 상세 화면의 단일 기준이다.
  // 카드 클릭·뒤로가기·새로고침·링크 직접 진입이 모두 이 한 경로로 처리된다.
  useEffect(() => {
    if (!authReady || !dataReady) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 주소나 초기 데이터 준비 상태가 바뀔 때만 다시 연다
  }, [sessionParam, authReady, dataReady]);

  useEffect(() => {
    if (!authReady) return;
    let activeLoad = true;

    void listReports().then(
      (result) => {
        if (!activeLoad) return;
        setStep(entryInitialStep[entry]);
        setHistoryError(null);
        setReports(result.reports);
        setDataReady(true);
      },
      () => {
        if (!activeLoad) return;
        setStep(entryInitialStep[entry]);
        setReports([]);
        setHistoryError("완료된 연습 노트 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
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

  function resolveReportForSession(
    practiceSessionId: string,
    sourceReports: ReportRecord[] = reports,
  ): ResolvedReport | undefined {
    let resolved: ResolvedReport | undefined;
    sourceReports.forEach((record, index) => {
      if (record.practice_session_id === practiceSessionId) {
        resolved = { record, ordinal: index + 1 };
      }
    });
    return resolved;
  }

  async function showReportRecord(
    practiceSessionId: string,
    sourceReports: ReportRecord[],
  ): Promise<boolean> {
    const resolved = resolveReportForSession(practiceSessionId, sourceReports);
    if (!resolved) return false;
    setBusy(true);
    setError(null);
    setReportData(null);
    setPhase("report");
    try {
      const detail = await getReport(practiceSessionId);
      if (activeSessionRef.current !== practiceSessionId) return true;
      setReportData({
        report: detail.report,
        reportCount: resolved.ordinal,
      });
      playbackRefreshAttemptedRef.current = false;
      return true;
    } catch (reason) {
      if (activeSessionRef.current === practiceSessionId) {
        setError(errorMessage(reason));
        // 결과는 존재하지만 본문을 못 불러왔다 — "연습 노트 만들기" CTA 대신
        // 대화 화면으로 되돌려 잘못된 재생성을 막는다. 재진입하면 다시 조회한다.
        setPhase("coaching");
      }
      return true;
    } finally {
      if (activeSessionRef.current === practiceSessionId) setBusy(false);
    }
  }

  async function applySessionDetail(
    session: PracticeSessionDetail,
    sourceReports = reports,
  ) {
    setSessionDetail(session);

    if (session.status === "failed") {
      return;
    }

    if (
      session.status === "analyzed" &&
      resolveReportForSession(session.session_id, sourceReports)
    ) {
      await showReportRecord(session.session_id, sourceReports);
      return;
    }

    if (session.status === "analyzed") {
      void coachCoordinatorFor(session.session_id).update(session.status).catch(() => {});
    }
  }

  function coachCoordinatorFor(practiceSessionId: string): CoachStartCoordinator {
    if (coachCoordinatorRef.current?.sessionId === practiceSessionId) {
      return coachCoordinatorRef.current.coordinator;
    }
    const coordinator = createCoachStartCoordinator(() => startInterview(practiceSessionId));
    coachCoordinatorRef.current = { sessionId: practiceSessionId, coordinator };
    return coordinator;
  }

  async function pollSession(sessionId: string): Promise<PracticeSessionDetail | null> {
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;

    try {
      const initial = await getPracticeSession(sessionId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return null;
      setSessionDetail(initial);
      if (initial.status === "analyzed" || initial.status === "failed") {
        await applySessionDetail(initial);
        return initial;
      }

      const settled = await pollSessionUntilSettled(sessionId, {
        signal: controller.signal,
        onStatus: (status) => {
          if (controller.signal.aborted) return;
          // 정착 상태(analyzed/failed)는 이어지는 상세 조회가 성공한 뒤 applySessionDetail로만
          // 반영한다. 여기서 낙관적으로 바꾸면 상세 조회가 실패했을 때 summary 없는 완료 화면 +
          // 재조회 버튼이 사라진 상태로 굳어 복구가 막힌다.
          if (status === "analyzed" || status === "failed") return;
          setSessionDetail((current) =>
            current ? { ...current, status } : current,
          );
        },
      });
      if (controller.signal.aborted) return null;
      await applySessionDetail(settled);
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
    activeSessionRef.current = null;
    coachCoordinatorRef.current = null;
    setActive(null);
    setSessionDetail(null);
    setError(null);
    // 보류 중이던 상세 조회의 busy가 staleness 가드로 해제되지 못하는 경우를 대비
    setBusy(false);
  }

  function resetActiveFlow(sessionId: string) {
    activeSessionRef.current = sessionId;
    coachCoordinatorRef.current = null;
    setActive({ sessionId });
    setSessionDetail(null);
    setPhase("coaching");
    setCoach(null);
    setReportData(null);
    setAnswer("");
    setPendingAnswer(null);
    setCoachWaiting(false);
    setError(null);
    setBusy(false);
    playbackRefreshAttemptedRef.current = false;
  }

  function openSession(practiceSessionId: string) {
    // 상태를 직접 바꾸지 않고 주소를 바꾼다 — 나머지는 위 동기화 effect가 처리한다
    router.push(sessionDetailHref(practiceSessionId));
  }

  function showBlockageSelection() {
    const submission = submitSceneContext(Boolean(file), {
      situation,
      characterContext,
      goal,
    });
    if (submission.error) {
      setError(submission.error);
      return;
    }
    setError(null);
    setStep(submission.step);
  }

  async function begin(blockage: BlockageSelection) {
    const submission = submitSceneContext(Boolean(file), {
      situation,
      characterContext,
      goal,
    });
    if (!file || submission.error) {
      setError(submission.error ?? "영상을 다시 선택해 주세요.");
      setStep(submission.step);
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
        buildPracticeSessionRequest(
          upload.intentId,
          { situation, characterContext, goal },
          blockage,
        ),
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

  async function startInterview(practiceSessionId?: string) {
    const sessionAtStart = practiceSessionId ?? active?.sessionId;
    if (!sessionAtStart) {
      setError("세션을 찾을 수 없어요");
      return;
    }
    setBusy(true);
    setCoachWaiting(false);
    setError(null);
    try {
      const { data } = await startCoach(
        { practice_session_id: sessionAtStart },
        { onWait: () => setCoachWaiting(true) },
      );
      if (activeSessionRef.current !== sessionAtStart) return;
      const firstMessage = coachMessageText(data);
      const nextCoach: CoachState = {
        coachSessionId: data.session_id,
        turns: firstMessage === null ? [] : [{ role: "coach", text: firstMessage }],
        questionCount: firstMessage === null ? 0 : 1,
        done: data.status === "complete",
      };
      setCoach(nextCoach);
      setReportData(null);
      setPhase("coaching");
      const completed = completedCoachReport(data);
      if (completed) {
        // 노트는 받아 두되 화면은 바꾸지 않는다 — 배우가 직접 누를 때 넘어간다.
        setReportData({ report: completed, reportCount: reports.length + 1 });
        if (completed.report_type !== "blocked") {
          setReports((current) => [
            ...current.filter((item) => item.practice_session_id !== sessionAtStart),
            {
              created_at: new Date().toISOString(),
              practice_session_id: sessionAtStart,
              report_type: completed.report_type,
              title: completed.title,
            },
          ]);
          void listReports().then(
            (refreshed) => setReports(refreshed.reports),
            () => {},
          );
        }
      }
    } catch (reason) {
      if (activeSessionRef.current !== sessionAtStart) return;
      if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === "report already exists for practice session"
      ) {
        try {
          const refreshed = await listReports();
          setReports(refreshed.reports);
          if (activeSessionRef.current !== sessionAtStart) return;
          if (!(await showReportRecord(sessionAtStart, refreshed.reports))) {
            throw new Error("완료된 연습 노트를 불러오지 못했어요.");
          }
        } catch (refreshError) {
          if (activeSessionRef.current !== sessionAtStart) return;
          setError(errorMessage(refreshError));
        }
      } else {
        setError(sessionErrorMessage(reason));
      }
    } finally {
      if (activeSessionRef.current === sessionAtStart) {
        setCoachWaiting(false);
        setBusy(false);
      }
    }
  }

  async function reply() {
    const text = answer.trim();
    if (!active || !coach || coach.done || !text) return;
    const sessionAtStart = active.sessionId;
    setPendingAnswer(text);
    setBusy(true);
    setCoachWaiting(false);
    setError(null);
    try {
      const { data } = await replyCoach(
        { session_id: coach.coachSessionId, text },
        { onWait: () => setCoachWaiting(true) },
      );
      if (activeSessionRef.current !== sessionAtStart) return;
      const coachMessage = coachMessageText(data);
      setCoach({
        coachSessionId: data.session_id,
        turns: [
          ...coach.turns,
          { role: "actor", text },
          ...(coachMessage === null
            ? []
            : [{ role: "coach" as const, text: coachMessage }]),
        ],
        questionCount: coach.questionCount + (coachMessage === null ? 0 : 1),
        done: data.status === "complete",
      });
      setAnswer("");
      const completed = completedCoachReport(data);
      if (completed) {
        // 노트는 받아 두되 화면은 바꾸지 않는다 — 배우가 직접 누를 때 넘어간다.
        setReportData({ report: completed, reportCount: reports.length + 1 });
        if (completed.report_type !== "blocked") {
          setReports((current) => [
            ...current.filter((item) => item.practice_session_id !== sessionAtStart),
            {
              created_at: new Date().toISOString(),
              practice_session_id: sessionAtStart,
              report_type: completed.report_type,
              title: completed.title,
            },
          ]);
          void listReports().then(
            (refreshed) => setReports(refreshed.reports),
            () => {},
          );
        }
      }
    } catch (reason) {
      if (activeSessionRef.current !== sessionAtStart) return;
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
      if (activeSessionRef.current === sessionAtStart) {
        setPendingAnswer(null);
        setCoachWaiting(false);
        setBusy(false);
      }
    }
  }

  async function refreshPlayback() {
    if (!active) return;
    if (playbackRefreshAttemptedRef.current) {
      setError("영상을 다시 불러왔지만 재생할 수 없어요.");
      return;
    }
    playbackRefreshAttemptedRef.current = true;
    try {
      const refreshed = await getPracticeSession(active.sessionId);
      setSessionDetail(refreshed);
    } catch {
      setError("영상 재생 링크를 다시 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function handleLogout() {
    await logout();
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

  // 삭제된 세션을 목록(노트)에서 걷어낸다 — 삭제 성공 후, 그리고 이미 사라진(404) 경우에도 부른다.
  // 목록은 reports 기준이라 그 세션의 노트만 지우면 카드가 사라진다.
  function forgetDeletedSession(sessionId: string) {
    pollControllerRef.current?.abort();
    setReports((items) => items.filter((item) => item.practice_session_id !== sessionId));
  }

  async function deleteSession() {
    const sessionId = sessionParam ?? active?.sessionId;
    if (!sessionId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePracticeSession(sessionId);
      forgetDeletedSession(sessionId);
      // 주소에서 세션을 떼면 동기화 effect가 목록 화면으로 되돌린다.
      // replace라 뒤로가기로 지운 세션에 다시 들어가지 않는다.
      router.replace(SESSION_DETAIL_PATH);
    } catch (reason) {
      // 404는 이미 지워졌거나 남의 리소스 — 조용히 목록으로 보낸다
      if (reason instanceof ApiError && reason.status === 404) {
        forgetDeletedSession(sessionId);
        router.replace(SESSION_DETAIL_PATH);
        return;
      }
      setError(sessionErrorMessage(reason));
    } finally {
      setDeleting(false);
    }
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
        answer={answer}
        pendingAnswer={pendingAnswer}
        busy={busy}
        deleting={deleting}
        coachWaiting={coachWaiting}
        error={error}
        setAnswer={setAnswer}
        onStartCoach={() => {
          void coachCoordinatorFor(activeSessionId).startWithoutEvidence().catch(() => {});
        }}
        onReply={reply}
        onOpenReport={() => setPhase("report")}
        onPlaybackError={refreshPlayback}
        onDelete={deleteSession}
      />
    );
  }

  const displayName = storedName ?? formatDisplayName(user);

  if (step === "home") {
    return (
      <PracticeHome
        displayName={displayName}
        historyError={historyError}
        reports={reports}
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
        reports={reports}
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

  if (step === "blockage") {
    return (
      <main className="min-h-dvh bg-[#f7faff] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <BlockageSelectionFlow
            videoUrl={previewUrl ?? ""}
            scene={{
              situation,
              character: characterContext,
              goal,
            }}
            busy={busy}
            onComplete={(selection) => void begin(selection)}
          />
          {error ? <ErrorNotice message={error} /> : null}
        </div>
      </main>
    );
  }

  return (
    <PracticeContextScreen
      file={file}
      previewUrl={previewUrl}
      situation={situation}
      characterContext={characterContext}
      goal={goal}
      busy={busy}
      uploadProgress={uploadProgress}
      error={error}
      onBack={returnToVideoSelection}
      onSituationChange={setSituation}
      onCharacterContextChange={setCharacterContext}
      onGoalChange={setGoal}
      onSubmit={showBlockageSelection}
    />
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-3 text-base font-black text-[#333d4b]">
      <span className="flex items-center gap-2">{label} <RequiredBadge /></span>
      <textarea
        className="min-h-28 rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
        value={value}
        placeholder={placeholder}
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
  reports,
  onLogout,
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  reports: ReportRecord[];
  onLogout: () => void | Promise<void>;
  onOpen: (practiceSessionId: string) => void;
}) {
  const visibleReports = [...reports].reverse();

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
        ) : reports.length === 0 ? (
          <div className="rounded-[24px] bg-[#f8fbff] px-6 py-11 text-center">
            <div className="text-[15px] font-black tracking-[-0.02em]">아직 연습 기록이 없어요</div>
            <div className="mt-2 text-[13px] font-semibold text-[#4e5968]">첫 영상을 올리면 이곳에 장면별 연습 기록이 쌓입니다.</div>
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleReports.map((report) => (
              <button key={report.practice_session_id} type="button" onClick={() => onOpen(report.practice_session_id)} className="flex w-full min-w-0 items-center gap-3.5 rounded-[20px] bg-white p-4 text-left shadow-[0_16px_45px_rgba(25,31,40,0.06)] transition hover:-translate-y-0.5">
                <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#0b1220,#1b2942)] text-[11px] font-black text-[#8fb4ff]">▶</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black tracking-[-0.02em]">{report.title}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-[#8b95a1]">{formatRelativePracticeDate(report.created_at)}</span>
                </span>
                <span className="shrink-0 rounded-full bg-[#e5f8ef] px-3 py-1.5 text-xs font-black text-[#009959]">완료</span>
              </button>
            ))}
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
  reports,
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  reports: ReportRecord[];
  onOpen: (practiceSessionId: string) => void;
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
              완성된 연습 노트를 한곳에서 확인할 수 있어요.
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
          reports={reports}
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
  goal,
  busy,
  uploadProgress,
  error,
  onBack,
  onSituationChange,
  onCharacterContextChange,
  onGoalChange,
  onSubmit,
}: {
  file: File | null;
  previewUrl: string | null;
  situation: string;
  characterContext: string;
  goal: string;
  busy: boolean;
  uploadProgress: UploadProgressState | null;
  error: string | null;
  onBack: () => void;
  onSituationChange: (value: string) => void;
  onCharacterContextChange: (value: string) => void;
  onGoalChange: (value: string) => void;
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
            goal={goal}
            onSituationChange={onSituationChange}
            onCharacterContextChange={onCharacterContextChange}
            onGoalChange={onGoalChange}
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
                  : "막히는 지점 고르기"}
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
  goal,
  onSituationChange,
  onCharacterContextChange,
  onGoalChange,
}: {
  situation: string;
  characterContext: string;
  goal: string;
  onSituationChange: (value: string) => void;
  onCharacterContextChange: (value: string) => void;
  onGoalChange: (value: string) => void;
}) {
  return (
    <section className="mt-6 grid gap-6 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm sm:p-7">
      <TextField label="상황" value={situation} placeholder="이별을 통보받은 직후, 카페에서" onChange={onSituationChange} />
      <TextField label="인물" value={characterContext} placeholder="담담한 척하는 20대 후반 여성" onChange={onCharacterContextChange} />
      <TextField label="목표" value={goal} placeholder="상대가 마음을 돌려 다시 앉게 만들기" onChange={onGoalChange} />
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
  reports,
  onOpen,
  variant = "recent",
}: {
  error?: string | null;
  reports: ReportRecord[];
  onOpen: (practiceSessionId: string) => void;
  variant?: "recent" | "full";
}) {
  const newestReports = [...reports].reverse();
  const visibleReports = variant === "full" ? newestReports : newestReports.slice(0, 3);

  return (
    <section className="mt-10 pb-10">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-black tracking-[-0.05em]">{variant === "full" ? "전체 연습 기록" : "최근 연습"}</h2>
        {variant === "recent" && reports.length > 0 ? <Link href="/practice/history" className="text-base font-black text-[#2f6bff] transition hover:text-[#1b64da]">전체 보기</Link> : null}
      </header>

      {error ? (
        <div role="alert" className="mt-5 rounded-[24px] border border-[#ffd8a8] bg-[#fff8ec] p-6">
          <p className="text-lg font-black text-[#8a4b00]">연습 기록을 불러오지 못했어요</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8a4b00]">{error}</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8a4b00]">새 연습은 계속 시작할 수 있어요.</p>
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="mt-5 rounded-[24px] border border-dashed border-[#c8d9f7] bg-[#f7faff] p-8 text-center">
          <p className="text-xl font-black tracking-[-0.04em]">아직 연습 기록이 없어요</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8b95a1]">첫 영상을 올리면 이곳에 장면별 연습 기록이 쌓입니다.</p>
          <Link href="/practice/new" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">첫 연습 시작하기</Link>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleReports.map((report) => (
            <PracticeHistoryCard
              key={report.practice_session_id}
              report={report}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PracticeHistoryCard({
  report,
  onOpen,
}: {
  report: ReportRecord;
  onOpen: (practiceSessionId: string) => void;
}) {
  const content = (
    <>
      <div className="relative flex aspect-[2.78/1] items-center justify-center bg-[#1f2937]" style={{ backgroundImage: "repeating-linear-gradient(45deg, #202938 0 22px, #182131 22px 44px)" }}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#191f28] shadow-sm"><PlayIcon /></span>
      </div>
      <div className="px-5 py-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-lg font-black tracking-[-0.04em]">{report.title}</h3>
          </div>
          <span className="shrink-0 rounded-full bg-[#e5f8ef] px-3 py-1.5 text-xs font-black text-[#009959]">완료</span>
        </div>
        <p className="mt-4 text-sm font-bold text-[#b0b8c1]">{formatRelativePracticeDate(report.created_at)}</p>
      </div>
    </>
  );

  const className = "overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(25,31,40,0.08)]";
  return <button type="button" className={className} onClick={() => onOpen(report.practice_session_id)}>{content}</button>;
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
  answer,
  pendingAnswer,
  busy,
  deleting,
  coachWaiting,
  error,
  setAnswer,
  onStartCoach,
  onReply,
  onOpenReport,
  onPlaybackError,
  onDelete,
}: {
  session: PracticeSessionDetail;
  phase: Phase;
  coach: CoachState | null;
  reportData: ReportData | null;
  answer: string;
  pendingAnswer: string | null;
  busy: boolean;
  deleting: boolean;
  coachWaiting: boolean;
  error: string | null;
  setAnswer: (value: string) => void;
  onStartCoach: () => void;
  onReply: () => void;
  onOpenReport: () => void;
  onPlaybackError: () => void;
  onDelete: () => void;
}) {
  const analysisPending = session.status === "created" || session.status === "analyzing";
  const analysisFailed = session.status === "failed";
  // 화면이 열려 있는 내내 자리를 지키는 안내 영역. 조건부로 붙였다 떼면 보조기술이 못 읽으므로
  // 노드는 그대로 두고 글자만 바꾼다.
  const liveStatus =
    phase === "report" ? (reportData ? "연습 노트가 완성됐어요" : "연습 노트를 만들고 있어요") : "";

  return (
    <main className="min-h-dvh bg-[#f8fafc] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <span role="status" className="sr-only">{liveStatus}</span>
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
            </div>
            <h1 className="mt-5 text-2xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">{session.situation}</h1>
            <p className="mt-3 max-w-2xl font-semibold leading-7 text-[#6b7684]">{session.character_context}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={SESSION_DETAIL_PATH} className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">← 연습 기록</Link>
            <Link href="/home" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">홈</Link>
            <DeleteSessionControl deleting={deleting} onDelete={onDelete} />
          </div>
        </header>

        {phase === "coaching" ? (
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
            reportReady={reportData !== null}
            onOpenReport={onOpenReport}
            analysisPending={analysisPending}
            analysisFailed={analysisFailed}
          />
        ) : null}
        {phase === "report" ? (
          <Report
            reportData={reportData}
            playbackUrl={session.playback_url}
            busy={busy}
            onPlaybackError={onPlaybackError}
          />
        ) : null}
        {error && phase !== "coaching" ? <ErrorNotice message={error} /> : null}
      </div>
    </main>
  );
}

// 상세 화면 헤더의 삭제 버튼. 한 번 눌러 확인을 띄우고 다시 눌러야 지운다 —
// 실수로 지우는 걸 막되 브라우저 기본 confirm 팝업은 쓰지 않는다.
function DeleteSessionControl({
  deleting,
  onDelete,
}: {
  deleting: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#f1aeb5] bg-white px-4 text-sm font-black text-[#e03131] transition hover:border-[#e03131] hover:bg-[#fff5f5]"
      >
        삭제
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-2xl border border-[#f1aeb5] bg-[#fff5f5] px-2 py-1">
      <span className="pl-1 text-sm font-black text-[#c92a2a]">삭제할까요?</span>
      <button
        type="button"
        disabled={deleting}
        onClick={onDelete}
        className="inline-flex h-9 items-center justify-center rounded-xl bg-[#e03131] px-3 text-sm font-black text-white transition hover:bg-[#c92a2a] disabled:bg-[#f1aeb5]"
      >
        {deleting ? "삭제 중…" : "삭제"}
      </button>
      <button
        type="button"
        disabled={deleting}
        onClick={() => setConfirming(false)}
        className="inline-flex h-9 items-center justify-center rounded-xl border border-[#d1d6db] bg-white px-3 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]"
      >
        취소
      </button>
    </span>
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
  reportReady,
  onOpenReport,
  analysisPending,
  analysisFailed,
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
  reportReady: boolean;
  onOpenReport: () => void;
  analysisPending: boolean;
  analysisFailed: boolean;
}) {
  if (!coach) {
    return (
      <section className="mt-8 overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
        {analysisPending ? (
          <p role="status" className="border-b border-[#e5e8eb] bg-[#f7faff] px-5 py-3 text-sm font-semibold text-[#4e5968] sm:px-6">
            같이 볼 장면을 찾고 있어요
          </p>
        ) : null}
        {analysisFailed ? (
          <div className="p-5 sm:p-6">
            <h2 className="text-lg font-black leading-7 text-[#191f28]">
              영상을 바탕으로 질문을 준비하지 못했어요
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
              원하면 영상 근거 없이 대화를 시작할 수 있어요.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onStartCoach}
              className="mt-5 min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#3182f6] disabled:bg-[#b0d2ff]"
            >
              {busy ? "질문 준비 중…" : "그냥 시작"}
            </button>
          </div>
        ) : !error ? (
          <div role="log" aria-live="polite" aria-label="AI 코치와 나눈 대화" className="flex min-h-[320px] items-center justify-center bg-[#f7faff] px-5 py-6 sm:px-6">
            <p className="text-sm font-semibold text-[#8b95a1]">막히는 대목을 그대로 적어 주세요.</p>
          </div>
        ) : null}
        {!analysisFailed && !busy && error ? (
          <div className="p-5 sm:p-6">
            <button type="button" onClick={onStartCoach} className="min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#2f6bff]">코칭 시작 다시 시도</button>
            <ErrorNotice message={error} />
          </div>
        ) : null}
      </section>
    );
  }

  const currentQuestion = [...coach.turns]
    .reverse()
    .find((turn) => turn.role === "coach");
  const inputEnabled = isCoachInputEnabled({
    analysisStatus: analysisPending ? "analyzing" : analysisFailed ? "failed" : "analyzed",
    coachSessionId: coach.coachSessionId,
    sending: busy || coachWaiting,
    done: coach.done,
  });

  return (
    <section className="mt-8 overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
      {analysisPending ? (
        <p role="status" className="border-b border-[#e5e8eb] bg-[#f7faff] px-5 py-3 text-sm font-semibold text-[#4e5968] sm:px-6">
          같이 볼 장면을 찾고 있어요
        </p>
      ) : null}
      <header className="flex items-center justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-xs font-black text-white">AI</span>
          <div>
            <h2 className="font-black tracking-[-0.03em]">현재 장면을 바탕으로 질문하고 있어요</h2>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">질문 {Math.min(coach.questionCount, TURN_BUDGET)}/{TURN_BUDGET}</span>
      </header>

      {currentQuestion ? (
        <article className="border-b border-[#e5e8eb] bg-[#f7faff] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black text-[#2f6bff]">현재 질문</p>
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
        {/* 첫 요청이 도는 동안에는 onWait(재시도)가 불리지 않는다 — pendingAnswer를 기준으로 삼아야
            답변을 보낸 순간부터 끊기지 않고 대기 표시가 이어진다 */}
        {pendingAnswer !== null || coachWaiting ? (
          <div className="flex items-end gap-2">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span>
            <div className="rounded-2xl rounded-bl-md border border-[#e5e8eb] bg-white px-4 py-3 shadow-sm">
              <WaitingDots />
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[#e5e8eb] bg-white p-4 sm:p-5">
        {coach.done ? (
          reportReady ? (
            <div className="flex flex-col items-center gap-3">
              <p role="status" className="text-sm font-semibold text-[#4e5968]">지금까지 이야기한 걸 정리해 뒀어요.</p>
              <button
                type="button"
                onClick={onOpenReport}
                className="min-h-12 w-full rounded-2xl bg-[#2f6bff] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] sm:w-auto"
              >
                정리된 자료 보기
              </button>
            </div>
          ) : (
            <p role="status" className="rounded-2xl bg-[#f7faff] px-4 py-3 text-sm font-semibold text-[#4e5968]">
              정리하고 있어요…
            </p>
          )
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold text-[#8b95a1]">
              &apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <textarea
                aria-label="답변"
                rows={3}
                className="min-h-24 flex-1 resize-y rounded-2xl border border-[#d1d6db] bg-white p-4 text-[15px] font-semibold leading-6 outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff] disabled:bg-[#f2f4f6]"
                value={answer}
                disabled={!inputEnabled}
                placeholder="질문을 듣고 떠오른 생각을 편하게 적어 주세요."
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && answer.trim() && inputEnabled) {
                    event.preventDefault();
                    onReply();
                  }
                }}
              />
              <button type="button" disabled={!inputEnabled || !answer.trim()} onClick={onReply} className="min-h-12 shrink-0 rounded-2xl bg-[#2f6bff] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
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
  return (
    <div className={"flex items-end gap-2 " + (actor ? "justify-end" : "justify-start")}>
      {!actor ? <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span> : null}
      <div className={"max-w-[82%] rounded-2xl px-4 py-3 shadow-sm " + (actor ? "rounded-br-md bg-[#3182f6] text-white" : "rounded-bl-md border border-[#e5e8eb] bg-white text-[#191f28]")}>
        <p className="text-xs font-black opacity-70">{actor ? "나" : "AI 코치"}</p>
        <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">{turn.text}</p>
      </div>
    </div>
  );
}

function Report({
  reportData,
  playbackUrl,
  busy,
  onPlaybackError,
}: {
  reportData: ReportData | null;
  playbackUrl: string;
  busy: boolean;
  onPlaybackError: () => void;
}) {
  // 만드는 동안에는 완성될 화면과 같은 자리에 글자 자리만 비워 둔다
  if (!reportData && busy) return <ReportSkeleton />;

  if (!reportData) {
    return (
      <section className="mt-8 rounded-[28px] border border-[#dce9ff] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
        <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">코칭 완료</span>
        <h2 className="mt-3 text-lg font-black tracking-[-0.04em] sm:mt-4 sm:text-3xl">연습 노트를 만들어 보세요</h2>
        <p className="mt-2.5 max-w-2xl text-sm font-bold leading-6 text-[#6b7684] sm:mt-3 sm:text-base sm:leading-7">나눈 대화를 바탕으로 다음 연습에 가져갈 한 문장을 정리해요.</p>
        <p className="mt-6 text-sm font-semibold text-[#4e5968]">잠시 후에도 열리지 않으면 연습 기록에서 다시 확인해 주세요.</p>
      </section>
    );
  }

  const report = reportData.report;
  return (
    <section className="mt-8 grid gap-4">
      <PracticeReportCards report={report} />
      {report.report_type !== "blocked" ? (
        <div className="overflow-hidden rounded-[24px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.035)]">
          <video key={playbackUrl} controls preload="metadata" src={playbackUrl} onError={onPlaybackError} className="aspect-video w-full bg-[#111827] object-contain">
            분석한 영상을 재생할 수 없어요.
          </video>
        </div>
      ) : null}
      {/* 연습 노트가 나온 뒤에만 보인다 — 마치기를 누르면 후기 페이지로 넘어간다 */}
      {report.report_type !== "blocked" ? <aside className="rounded-[24px] border border-[#dce9ff] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div>
          <h3 className="text-base font-black tracking-[-0.035em] sm:text-lg">이번 연습은 어떠셨나요?</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968] sm:text-base sm:leading-7">짧은 설문으로 경험을 알려 주시면 더 나은 연기 코치를 만드는 데 활용할게요.</p>
        </div>
        {/* 새 창으로 연다 — 보던 연습 노트 화면을 유지한 채 후기를 남길 수 있게 */}
        <a href={REVIEW_FORM_URL} target="_blank" rel="noopener noreferrer" aria-label="연습 마치고 후기 남기기 (새 창)" className="mt-5 inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] sm:mt-0">연습 마치기 ↗</a>
      </aside> : null}
    </section>
  );
}

// 연습 노트를 만드는 동안 보여주는 뼈대 — 완성 화면의 앞부분(제목·카드)을 같은 순서로 둔다.
// 대화 로그와 후기 안내는 길이를 알 수 없어 넣지 않으므로 완료 시 아래쪽은 밀린다.
function ReportSkeleton() {
  return (
    // 시각적 뼈대만 맡는다 — 소리로 읽히는 안내는 SessionView의 상시 status 영역이 처리한다
    <section aria-busy="true" className="mt-8 grid animate-pulse gap-4">
      <header className="rounded-[28px] bg-[#2f6bff] p-5 shadow-[0_16px_36px_rgba(49,130,246,0.2)] sm:p-8">
        <div className="h-3.5 w-24 rounded-full bg-white/40" />
        <div className="mt-3 h-6 w-4/5 rounded-full bg-white/50 sm:h-9" />
        <div className="mt-2.5 h-6 w-3/5 rounded-full bg-white/40 sm:h-9" />
      </header>
      <article className="rounded-[24px] border border-[#dce9ff] bg-[#f7faff] p-4 sm:p-6">
        <div className="h-3.5 w-20 rounded-full bg-[#dce9ff]" />
        <div className="mt-3 h-5 w-40 rounded-full bg-[#dce9ff]" />
        <SkeletonLines className="mt-4" />
      </article>
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard wide />
      </div>
    </section>
  );
}

function SkeletonCard({ wide = false }: { wide?: boolean }) {
  return (
    <article className={(wide ? "md:col-span-2 " : "") + "rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:p-6"}>
      <div className="h-5 w-32 rounded-full bg-[#e5e8eb]" />
      <SkeletonLines className="mt-3" />
    </article>
  );
}

function SkeletonLines({ className = "" }: { className?: string }) {
  return (
    <div className={"grid gap-2.5 " + className}>
      <div className="h-4 rounded-full bg-[#eef1f4]" />
      <div className="h-4 rounded-full bg-[#eef1f4]" />
      <div className="h-4 w-2/3 rounded-full bg-[#eef1f4]" />
    </div>
  );
}
