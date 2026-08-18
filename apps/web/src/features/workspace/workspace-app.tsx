"use client";

// 홈 · 새 연습 · 연습 기록 · 세션 상세를 한 화면으로 합친 통합 워크스페이스.
// 왼쪽에 지난 세션 바, 오른쪽을 현재 세션이 채운다.
// 설계 정본은 새 UI 디자인 캔버스(2026-07-27)의 D1~D10 · M1~M9 화면.

import Image from "next/image";
import Link from "next/link";
import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import wordmark from "@/assets/acttub-wordmark.png";
import { getStoredDisplayName, loadDisplayName } from "@/features/auth/display-name";
import { logout } from "@/lib/api/v2/auth";
import { startCoach, replyCoach } from "@/lib/api/v2/coach";
import { listReports } from "@/lib/api/v2/reports";
import {
  deletePracticeSession,
  getPracticeSession,
  listPracticeSessions,
  pollSessionUntilSettled,
} from "@/lib/api/v2/sessions";
import type {
  CoachTurnResponse,
  PracticeReport,
  PracticeSessionDetail,
  PracticeSessionListItem,
  ReportRecord,
} from "@/lib/api/v2/types";
import { isLoggedIn } from "@/lib/auth/token-store";
import {
  trackDialogueStarted,
  trackResultViewed,
  trackVideoUploaded,
} from "@/lib/analytics/ga";
import {
  trackPracticeAbandoned,
  trackPracticeAnalysisSettled,
  trackPracticeBlockageStarted,
  trackPracticeBlockageSubmitted,
  trackPracticeDialogueCompleted,
  trackPracticeDialogueStartFailed,
  trackPracticeDialogueStarted,
  trackPracticeDialogueTurnFailed,
  trackPracticeDialogueTurnSent,
  trackPracticeHistoryOpened,
  trackPracticePrepOpened,
  trackPracticeResultViewed,
  trackPracticeSessionCreated,
  trackPracticeUploadFailed,
  trackPracticeVideoSelected,
} from "@/lib/analytics/amplitude";
import { ExitReviewModal, useExitReview } from "./exit-review";
import { BlockageSelectionFlow } from "../practice/blockage-selection";
import type { BlockageSelection } from "../practice/blockage-flow";
import {
  createCoachStartCoordinator,
  type CoachStartCoordinator,
  coachMessageText,
  completedCoachReport,
  isCoachInputEnabled,
} from "../practice/coach-contract";
import { WaitingDots } from "../practice/waiting-dots";
import { PracticeReportCards } from "../practice/practice-report-cards";
import { formatVideoDuration } from "../practice/practice-setup-flow";
import {
  analysisEventsForStatus,
  useAnalysisProgress,
} from "../practice/use-analysis-progress";
import { useActiveSession } from "./use-active-session";
import { useWorkspaceBusy } from "./use-workspace-busy";
import {
  uploadForCurrentFile,
  type PendingVideoUpload,
} from "./pending-video-upload";
import {
  describeStartFailure,
  startPractice,
  startVideoUpload,
  type PendingUploadResult,
  type PracticeStartFailure,
} from "./practice-start";
import {
  loadPracticeSession,
  type SessionLoadOutcome,
} from "./session-loading";
import {
  abandonedStage,
  currentReport,
  initialWorkspaceScreen,
  pickedVideo,
  workspaceScreenReducer,
  type ContinueFrom,
  type WorkspaceScreen,
} from "./workspace-state";
import {
  describeWorkspaceView,
  type WorkspaceStatusChip,
} from "./workspace-view";

const NEW_PRACTICE_SUBTITLE = "영상을 올리면 질문이 시작돼요";

type ChatMsg = { role: "ai" | "me"; text: string };

export function WorkspaceApp() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" aria-busy="true" />}>
      <WorkspaceInner />
    </Suspense>
  );
}

// 같은 화면에 머무르면서 주소만 갈아끼운다. router.replace 는 라우터 네비게이션을 타고,
// 그러면 useSearchParams 를 감싼 위 Suspense 가 다시 걸려 흰 화면이 한 번 깜빡인다 —
// 업로드가 끝나는 지점에서 새로고침처럼 보이던 게 이것이다. 화면을 실제로 옮기는
// 로그인·로그아웃 이동은 그대로 router 를 쓴다.
function replaceUrl(path: string): void {
  window.history.replaceState(null, "", path);
}

/** API turns의 첫 actor 항목은 장면 폼 값이라 대화에서 실제로 보낸 답변 수에서 뺀다. */
function dialogueTurnCount(turn: CoachTurnResponse): number {
  return Math.max(
    0,
    turn.turns.filter((message) => message.role === "actor").length - 1,
  );
}

function questionOrdinal(questionCount: number): string {
  const ordinals = [
    "첫 번째 질문",
    "두 번째 질문",
    "세 번째 질문",
    "네 번째 질문",
    "다섯 번째 질문",
  ];
  return ordinals[questionCount - 1] ?? `${questionCount}번째 질문`;
}

/** 백엔드와 같은 네 종료 표현을 분류하되, 원문은 계측 함수에 넘기지 않는다. */
function isActorClosing(text: string): boolean {
  const stripped = text.replace(/[\s.,!?~…·'"]/g, "");
  if (["그만", "종료", "끝", "여기까지"].includes(stripped)) return true;
  if (stripped.length > 10) return false;
  return /(?:^|\s)(?:그만|종료)(?:(?:할게|할래)(?:요)?|하자|하고\s*싶어요?|요|용)?[\s.,!?~…·'"]*$/.test(
    text,
  );
}

function WorkspaceInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");

  // 캐시를 초기값으로 써야 인증 게이트가 열린 첫 화면부터 호칭이 바뀌어 보이지 않는다.
  const [nickname, setNickname] = useState<string | null>(() => getStoredDisplayName());
  const [ready, setReady] = useState(false);
  const initialPrepTrackedRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn()) {
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`/login?next=${encodeURIComponent(`/practice/new${search}`)}`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 인증 확인 후 1회 게이트
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready || initialPrepTrackedRef.current) return;
    initialPrepTrackedRef.current = true;
    trackPracticePrepOpened("new");
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const resolvedNickname = await loadDisplayName();
      if (!cancelled) setNickname(resolvedNickname);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

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
  // 어느 화면인가는 전이 하나하나가 정한다 — 전이표는 workspace-state.ts 에 있다.
  const [screen, dispatch] = useReducer(
    workspaceScreenReducer,
    initialWorkspaceScreen,
  );
  // 어느 연습이 지금 화면인가. 그리는 값과 기다림 뒤에 묻는 값을 함께 든다 —
  // 취소 가드가 무엇을 통과시킬지는 전부 use-active-session.ts 가 정한다.
  const {
    id: activeId,
    current: currentSessionId,
    isCurrent: isCurrentSession,
    isCurrentOrFree: sessionIsCurrentOrFree,
    setCurrent: setCurrentSession,
  } = useActiveSession();
  // 화면 뒤에서 도는 일과 그것이 잠그는 것. 어느 연습의 일인지를 훅이 들고 있어
  // 자기가 켠 것만 자기가 끈다 — use-workspace-busy.ts.
  const {
    disabled: busyDisabled,
    start: startWork,
    clear: clearWork,
  } = useWorkspaceBusy();
  const [detail, setDetail] = useState<PracticeSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 준비 순서 입력. 고른 영상은 화면이 들고 있다 — 어느 자리까지 따라오는지가
  // 그 자리의 타입으로 적혀 있다(workspace-state.ts).
  const [situation, setSituation] = useState("");
  const [character, setCharacter] = useState("");
  const [goal, setGoal] = useState("");

  // 압축·업로드
  // 진행률의 상태·타이머·리셋은 전부 이 훅 안에 있다. 여기서는 벌어진 일만 알린다.
  const {
    pct,
    pastDeadline,
    videoDurationMs,
    report: reportProgress,
  } = useAnalysisProgress();

  // 대화
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [coachOpening, setCoachOpening] = useState(false);
  const coachIdRef = useRef<string | null>(null);
  const dialogueTurnCountRef = useRef(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const pendingUploadRef = useRef<PendingVideoUpload<PendingUploadResult> | null>(
    null,
  );
  const analysisControllerRef = useRef<AbortController | null>(null);
  // 주소로 이미 연 연습. 활성 세션과 값은 같지만 **주소 경로에서만** 세우는 시점이
  // 갈린다 — 이쪽은 조회를 띄우기 전에 서서 이펙트가 다시 도는 것을 막고, 활성 세션은
  // 조회가 끝난 뒤에 선다(그래야 첫 진입이 자기 가드에 걸리지 않는다). 목록·새 연습은
  // 둘을 나란히 세운다. 이 시점 차이가 둘을 못 합치게 하는 이유다.
  const urlLoadedRef = useRef<string | null>(null);
  const coachCoordinatorRef = useRef<{
    sessionId: string;
    coordinator: CoachStartCoordinator;
  } | null>(null);
  const practiceAnalyticsContextRef = useRef<{
    kind: BlockageSelection["blockage_kind"];
    subBranch: BlockageSelection["sub_branch"];
    withEvidence: boolean;
  } | null>(null);

  // 어느 연습에서 어느 Practice Stage 를 이미 세었는지. 대화와 노트 확인은 한 연습 안에서 여러 번
  // 열린다 — 노트를 보다 대화로 돌아갔다 오거나, 지난 연습을 다시 열거나.
  // 그대로 두면 자리별 수가 부풀어 어디서 사람이 빠지는지 못 읽는다.
  // 화면을 벗어났다 돌아오면 이 Set 은 비므로 그때는 다시 센다 — 유입경로 그래프는
  // 사람 수로 그려져 영향이 없고, 이걸 막으려면 기기에 기록을 남겨야 해서 두지 않았다.
  const countedStepsRef = useRef<Set<string>>(new Set());
  // 세션 id 는 열쇠로만 쓰고 GA4 로 보내지 않는다. 보내는 값은 ga.ts 가 정하고,
  // 그 파일이 주소에서 식별자를 씻어내는 이유가 여기에도 그대로 적용된다.
  const countStepOnce = useCallback(
    (practiceSessionId: string | null, stepName: "dialogue" | "result"): boolean => {
      if (!practiceSessionId) return false;
      const key = `${practiceSessionId}:${stepName}`;
      if (countedStepsRef.current.has(key)) return false;
      countedStepsRef.current.add(key);
      if (stepName === "dialogue") trackDialogueStarted();
      else trackResultViewed();
      return true;
    },
    [],
  );

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, screen]);

  const abandonmentSnapshotRef = useRef<{ screen: WorkspaceScreen; pct: number }>({
    screen,
    pct,
  });
  useEffect(() => {
    abandonmentSnapshotRef.current = { screen, pct };
  }, [screen, pct]);

  useEffect(
    () => () => {
      const snapshot = abandonmentSnapshotRef.current;
      const stage = abandonedStage(snapshot.screen);
      if (stage) {
        trackPracticeAbandoned(stage, dialogueTurnCountRef.current, snapshot.pct);
      }
    },
    [],
  );

  // 화면이 로컬 원본을 놓는 순간 그 blob 주소도 놓아 준다.
  const pickedUrl = pickedVideo(screen)?.url ?? null;
  useEffect(
    () => () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );

  // 떠날 때 남은 요청을 끊는다. 화면 안에서 영상을 갈아 끼우거나 다른 연습으로
  // 넘어가는 길은 저마다 discardPendingUpload 로 이미 끊고 간다.
  useEffect(
    () => () => {
      uploadControllerRef.current?.abort();
      analysisControllerRef.current?.abort();
    },
    [],
  );

  // 세션 하나가 분석 구간에 들어섰음을 알린다. 조회가 끝난 뒤에만 부른다 —
  // 미리 부르면 조회가 실패한 자리에 1초 타이머가 그대로 남는다.
  const enterAnalysis = useCallback(
    (status: PracticeSessionDetail["status"], compressed: boolean) => {
      for (const event of analysisEventsForStatus(status, compressed)) {
        reportProgress(event);
      }
    },
    [reportProgress],
  );

  // 미리 시작한 압축·업로드를 버린다. 끊지 않으면 배우가 떠난 뒤에도 폰이 계속 인코딩한다.
  const discardPendingUpload = useCallback(() => {
    pendingUploadRef.current?.controller.abort();
    pendingUploadRef.current = null;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
  }, []);

  // 되돌아간 준비 화면이 이어받을 연습을 들고 설지까지 여기서 정한다 —
  // 옛 코드는 되돌린 뒤에 그 표시를 따로 켜야 했고, 순서를 뒤집으면 배너가 뜨지 않았다.
  const resetTo = useCallback((continueFrom: ContinueFrom | null) => {
    discardPendingUpload();
    analysisControllerRef.current?.abort();
    trackPracticePrepOpened("reset");
    setCurrentSession(null);
    dispatch({ type: "reset", continueFrom });
    setDetail(null);
    setMessages([]);
    setCoachOpening(false);
    coachIdRef.current = null;
    dialogueTurnCountRef.current = 0;
    coachCoordinatorRef.current = null;
    practiceAnalyticsContextRef.current = null;
    urlLoadedRef.current = null;
    reportProgress({ type: "reset" });
    setError(null);
    // 여기까지 오면 어느 연습의 일도 이 화면의 것이 아니다. 늦게 도착할 그 조회는
    // 자기가 켠 표시를 못 찾아 아무것도 되살리지 못한다.
    clearWork();
    setSituation("");
    setCharacter("");
    setGoal("");
    setDrawerOpen(false);
    replaceUrl("/practice/new");
  }, [clearWork, discardPendingUpload, reportProgress, setCurrentSession]);

  const resetToPrep = useCallback(() => resetTo(null), [resetTo]);

  // 끝난 연습의 노트에서 "이어서 새 연습" — 새 연습 준비 화면으로 가되, 코치가 이
  // 연습의 대화를 이어받도록 표시해 둔다.
  const continueFromCurrent = useCallback(() => {
    const id = currentSessionId();
    if (!id) return;
    const situationLabel = detail?.situation.trim();
    resetTo({
      id,
      // 자리표시자(".")로 채워진 장면은 이름이 못 된다.
      label: situationLabel && situationLabel.length > 1 ? situationLabel : null,
    });
  }, [currentSessionId, detail, resetTo]);

  // 지금 상태가 무엇을 그리는지는 전부 이 순수 함수가 정한다. 렌더보다 위에 있는 이유는
  // 바로 아래 후기 훅이 그 결과를 인자로 받기 때문이다 — 훅은 조건부로 부를 수 없다.
  const view = describeWorkspaceView({
    screen,
    playbackUrl: detail?.playback_url ?? null,
  });
  const body = view.body;

  // 후기는 대화가 시작된 뒤에만 묻는다 — 영상만 올리고 나간 사람은 답할 게 없다.
  const reviewArmed = view.review.armed;
  const {
    trigger: reviewTrigger,
    openFromButton: openReview,
    close: closeReview,
    markDone: markReviewDone,
  } = useExitReview(reviewArmed, view.review.kind);

  // 마치기로 연 후기 창을 닫으면 연습을 끝낸 것으로 보고 새 연습 준비 화면으로 돌아간다.
  // 커서 이탈·뒤로가기로 뜬 창은 보던 화면을 그대로 둔다.
  const wasOpenedByButton = reviewTrigger === "x";
  const onReviewClose = useCallback(() => {
    closeReview();
    if (wasOpenedByButton) resetToPrep();
  }, [closeReview, wasOpenedByButton, resetToPrep]);

  const pushAi = useCallback(
    (
      turn: CoachTurnResponse,
      endedBy: "coach" | "actor_closing" = "coach",
    ) => {
      // 코치 세션 id 는 매 응답마다 회전할 수 있어 다음 reply 에 최신 값을 쓴다.
      coachIdRef.current = turn.session_id;
      dialogueTurnCountRef.current = dialogueTurnCount(turn);
      const message = coachMessageText(turn);
      setMessages((m) => [...m, { role: "ai", text: message }]);
      const completed = completedCoachReport(turn);
      // 노트는 받아 두되 화면은 그대로 둔다 — 마지막 인사를 읽고 배우가 직접 넘어간다.
      dispatch({
        type: "coachTurnReceived",
        coachId: turn.session_id,
        done: turn.status === "complete",
        report: completed,
      });
      if (turn.status === "complete") {
        trackPracticeDialogueCompleted(
          dialogueTurnCountRef.current,
          completed?.report_type ?? "blocked",
          endedBy,
        );
      }
      if (completed) void refreshList();
    },
    [refreshList],
  );

  // 대화를 끝낸 뒤 배우가 직접 누를 때만 노트로 넘긴다. 지난 연습을 여는 경로는
  // 이미 노트가 목적지라 여기를 거치지 않는다.
  const openNote = useCallback(() => {
    dispatch({ type: "noteOpened" });
    const opened = currentReport(screen);
    if (opened && countStepOnce(currentSessionId(), "result")) {
      trackPracticeResultViewed(
        opened.report_type,
        dialogueTurnCountRef.current,
        "current",
      );
    }
  }, [countStepOnce, currentSessionId, screen]);

  const restoreCoach = useCallback((turn: CoachTurnResponse) => {
    coachIdRef.current = turn.session_id;
    dialogueTurnCountRef.current = dialogueTurnCount(turn);
    const restored: ChatMsg[] | undefined = turn.turns?.map((message) => ({
      role: message.role === "actor" ? "me" : "ai",
      text: message.text,
    }));
    setMessages(
      restored ?? [{ role: "ai", text: coachMessageText(turn) }],
    );
    const completed = completedCoachReport(turn);
    // 첫 응답이 곧바로 complete 로 오는 경우가 있다. 재개 응답은 항상 continue 다.
    // 그때도 화면은 그대로 두고 배우가 정리보기를 누를 때 넘긴다.
    dispatch({
      type: "coachTurnReceived",
      coachId: turn.session_id,
      done: turn.status === "complete",
      report: completed,
    });
    if (turn.status === "complete") {
      trackPracticeDialogueCompleted(
        dialogueTurnCountRef.current,
        completed?.report_type ?? "blocked",
        "coach",
      );
    }
    if (completed) void refreshList();
  }, [refreshList]);

  const coordinatorFor = useCallback((practiceSessionId: string) => {
    if (coachCoordinatorRef.current?.sessionId === practiceSessionId) {
      return coachCoordinatorRef.current.coordinator;
    }

    const coordinator = createCoachStartCoordinator(async () => {
      if (!isCurrentSession(practiceSessionId)) return;
      dispatch({ type: "coachStarting" });
      setCoachOpening(true);
      setError(null);
      try {
        const { data: start } = await startCoach({
          practice_session_id: practiceSessionId,
        });
        if (!isCurrentSession(practiceSessionId)) return;
        restoreCoach(start);
        if (countStepOnce(practiceSessionId, "dialogue")) {
          const context = practiceAnalyticsContextRef.current;
          if (context) {
            trackPracticeDialogueStarted(
              context.withEvidence,
              context.kind,
              context.subBranch,
            );
          }
        }
      } catch (reason) {
        trackPracticeDialogueStartFailed(false);
        if (isCurrentSession(practiceSessionId)) {
          setError("코치 연결에 실패했어요. 잠시 후 다시 시도해 주세요.");
        }
        throw reason;
      } finally {
        if (isCurrentSession(practiceSessionId)) setCoachOpening(false);
      }
    });
    coachCoordinatorRef.current = { sessionId: practiceSessionId, coordinator };
    return coordinator;
  }, [countStepOnce, isCurrentSession, restoreCoach]);

  const startConversationAfterAnalysis = useCallback((practiceSessionId: string) => {
    void coordinatorFor(practiceSessionId).update("analyzed").catch(() => {});
  }, [coordinatorFor]);

  const startConversationWithoutEvidence = useCallback((practiceSessionId: string) => {
    if (practiceAnalyticsContextRef.current) {
      practiceAnalyticsContextRef.current.withEvidence = false;
    }
    void coordinatorFor(practiceSessionId).startWithoutEvidence().catch(() => {});
  }, [coordinatorFor]);

  const trackAnalysis = useCallback((practiceSessionId: string) => {
    analysisControllerRef.current?.abort();
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    // 이 폴링이 얼마나 걸렸는지만 재는 시계다. 막대가 쓰는 경과 시간은 훅이 따로 잰다.
    const startedAt = Date.now();
    void pollSessionUntilSettled(practiceSessionId, {
      // 분석이 끝나도 이 간격만큼은 화면이 모른다. 4초 → 3초로만 줄인다.
      // 더 줄이지 않는 이유는 사용자당 60회/분 제한을 이 폴링이 혼자 먹기 때문이다
      // (3초면 20회/분, 두 탭이어도 40회/분). client.ts 에 429 백오프가 생기기
      // 전까지는 429 한 번에 폴링이 끊기고 화면이 오류로 남는다.
      intervalMs: 3000,
      signal: controller.signal,
      onStatus: (status) => {
        if (!isCurrentSession(practiceSessionId)) return;
        dispatch({ type: "analysisStatusReported", status });
      },
    }).then(
      (settled) => {
        if (!isCurrentSession(practiceSessionId) || controller.signal.aborted) return;
        dispatch({ type: "analysisStatusReported", status: settled.status });
        reportProgress({ type: "settle", status: settled.status });
        setDetail(settled);
        practiceAnalyticsContextRef.current = {
          kind: settled.blockage_kind,
          subBranch: settled.sub_branch as BlockageSelection["sub_branch"],
          withEvidence: settled.status === "analyzed",
        };
        if (settled.status === "analyzed" || settled.status === "failed") {
          trackPracticeAnalysisSettled(
            settled.status,
            settled.error_code,
            Date.now() - startedAt,
          );
        }
        void refreshList();
        void coordinatorFor(practiceSessionId).update(settled.status).catch(() => {});
      },
      () => {
        if (isCurrentSession(practiceSessionId)) {
          setError("장면을 살펴보는 상태를 확인하지 못했어요. 잠시 후 목록에서 다시 열어 주세요.");
        }
      },
    ).finally(() => {
      if (analysisControllerRef.current === controller) analysisControllerRef.current = null;
    });
  }, [coordinatorFor, isCurrentSession, refreshList, reportProgress]);

  const onPickFile = (file: File | null) => {
    // 영상을 고르는 길은 준비 화면에만 열려 있다. 그 밖에서 들어오면 만들어 둔
    // blob 주소를 놓아 줄 자리가 없다.
    if (!file || screen.kind !== "prep") return;
    const isReselect = screen.video !== null;
    // 고르던 영상을 바꾸면 앞서 시작한 압축·업로드는 버린다.
    discardPendingUpload();
    reportProgress({ type: "reset" });
    dispatch({
      type: "videoPicked",
      video: { file, url: URL.createObjectURL(file) },
    });
    setError(null);
    trackPracticeVideoSelected(file.size, isReselect);
  };

  // 올리는 일 자체는 practice-start 가 한다. 여기 남는 것은 "지금 도는 업로드가
  // 무엇인가" 를 들고 있는 두 ref 뿐이다.
  const startUpload = useCallback((file: File): PendingVideoUpload<PendingUploadResult> => {
    uploadControllerRef.current?.abort();
    const pending = startVideoUpload(file, { onProgress: reportProgress });
    uploadControllerRef.current = pending.controller;
    pendingUploadRef.current = pending;
    return pending;
  }, [reportProgress]);

  const begin = useCallback(async (blockage: BlockageSelection) => {
    // 막힘 선택 화면만 이 길로 온다. 그 화면이 올릴 영상과 이어받을 연습을 들고 있다.
    if (screen.kind !== "blockage") return;
    const { video, continueFrom } = screen;
    trackPracticeBlockageSubmitted(
      blockage.blockage_kind,
      blockage.sub_branch,
      blockage.blockage_detail,
    );
    setError(null);
    dispatch({ type: "uploadStarted" });
    // 현재 영상으로 미리 띄운 업로드만 이어받는다. 파일이 다르면 옛 업로드를 버리고 새로 시작한다.
    const { controller, promise } = uploadForCurrentFile(
      pendingUploadRef.current,
      video.file,
      startUpload,
    );
    const reportFailure = (failure: PracticeStartFailure) => {
      trackPracticeUploadFailed(failure.stage, failure.cause);
      // 지금 도는 업로드가 아니면 화면은 이미 다른 것을 그리고 있다.
      if (uploadControllerRef.current !== controller) return;
      dispatch({ type: "uploadFailed" });
      if (!failure.aborted) setError(failure.message);
    };
    const releaseUpload = () => {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
      if (pendingUploadRef.current?.controller === controller) {
        pendingUploadRef.current = null;
      }
    };
    const started = await startPractice({
      upload: promise,
      signal: controller.signal,
      scene: { situation, characterContext: character, goal },
      blockage,
      continueFromId: continueFrom?.id,
    });
    // 실패 처리를 아래 try 안에 두면, 이 처리 자신이 터졌을 때 catch 가 같은 실패를
    // 한 번 더 센다 — 옛 코드에서는 실패 처리가 catch 안에 있어 그럴 수 없었다.
    if (!started.ok) {
      try {
        reportFailure(started);
      } finally {
        releaseUpload();
      }
      return;
    }
    try {
      const { session, durationMs, compressionRan } = started;
      setCurrentSession(session.session_id);
      coachCoordinatorRef.current = null;
      practiceAnalyticsContextRef.current = {
        kind: blockage.blockage_kind,
        subBranch: blockage.sub_branch,
        withEvidence: session.status === "analyzed",
      };
      setDetail(null);
      reportProgress({ type: "duration", videoDurationMs: durationMs });
      enterAnalysis(session.status, compressionRan);
      dispatch({ type: "sessionCreated", status: session.status });
      setSending(false);
      urlLoadedRef.current = session.session_id;
      replaceUrl(`/practice/new?session=${encodeURIComponent(session.session_id)}`);
      // 업로드가 끝난 시점이 아니라 연습 세션까지 만들어진 시점에 센다.
      // 업로드만 되고 세션 생성이 실패하면 연습이 시작된 게 아니다.
      trackVideoUploaded(durationMs);
      trackPracticeSessionCreated(
        durationMs,
        blockage.blockage_kind,
        blockage.sub_branch,
      );
      trackAnalysis(session.session_id);
      void getPracticeSession(session.session_id).then(
        (loaded) => {
          if (!isCurrentSession(session.session_id)) return;
          // 상세 조회는 장면 정보만 채운다 — 분석 상태는 먼저 시작한 폴링만 갱신한다.
          setDetail(loaded);
        },
        () => {},
      );
      void refreshList();
    } catch (err) {
      // 시작 자체의 실패는 결과로 오므로, 여기 닿는 것은 세션을 받아 화면을 갈아
      // 끼우는 도중의 예외뿐이다. 옛 코드가 그것을 세션 생성 실패와 한 자리에
      // 세고 있었고, 그대로 둔다.
      reportFailure(describeStartFailure("session_create", err));
    } finally {
      releaseUpload();
    }
  }, [
    screen,
    situation,
    character,
    goal,
    enterAnalysis,
    isCurrentSession,
    setCurrentSession,
    refreshList,
    reportProgress,
    startUpload,
    trackAnalysis,
  ]);

  const send = useCallback(async (reply?: string) => {
    const text = (reply ?? answer).trim();
    if (!text || sending || !coachIdRef.current) return;
    const turnIndex = dialogueTurnCountRef.current + 1;
    setMessages((m) => [...m, { role: "me", text }]);
    setAnswer("");
    setSending(true);
    trackPracticeDialogueTurnSent(turnIndex, text);
    try {
      const { data: turn } = await replyCoach({ session_id: coachIdRef.current, text });
      pushAi(turn, isActorClosing(text) ? "actor_closing" : "coach");
    } catch {
      trackPracticeDialogueTurnFailed(turnIndex);
      setMessages((m) => [
        ...m,
        { role: "ai", text: "(연결이 잠시 끊겼어요. 다시 답해 주세요.)" },
      ]);
    } finally {
      setSending(false);
    }
  }, [answer, sending, pushAi]);

  const restartAfterBlocked = useCallback(async () => {
    const practiceSessionId = currentSessionId();
    if (!practiceSessionId) return;
    const doneRestarting = startWork("restartingChat", practiceSessionId);
    setError(null);
    // 지난 대화도 그 노트도 여기서 버린다 — 처음부터 다시 여는 길이다.
    dispatch({ type: "coachStarting" });
    setMessages([]);
    setCoachOpening(true);
    coachIdRef.current = null;
    dialogueTurnCountRef.current = 0;
    try {
      const { data } = await startCoach({
        practice_session_id: practiceSessionId,
        restart: true,
      });
      if (!isCurrentSession(practiceSessionId)) return;
      restoreCoach(data);
    } catch {
      trackPracticeDialogueStartFailed(true);
      if (isCurrentSession(practiceSessionId)) {
        setError("대화를 다시 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      // 코치를 기다리는 표시는 화면의 것이라 지금 화면일 때만 내린다. 도는 일 쪽은
      // 자기가 켠 것을 스스로 알아보므로 가드 없이 끝맺는다.
      if (isCurrentSession(practiceSessionId)) setCoachOpening(false);
      doneRestarting();
    }
  }, [currentSessionId, isCurrentSession, restoreCoach, startWork]);

  // 받아 온 연습으로 화면을 옮긴다. 두 진입 경로가 이 자리를 공유하고, 그 앞뒤로
  // 저마다 더 하는 일(주소로 온 길은 자기 자리부터 잡는다)은 각자에게 남는다.
  const showLoadedSession = useCallback((loaded: PracticeSessionDetail) => {
    setDetail(loaded);
    // 목록·주소로 연 세션은 압축을 탔는지도 영상 길이도 모른다 — 무압축 쪽 시작점에서 출발한다.
    enterAnalysis(loaded.status, false);
    practiceAnalyticsContextRef.current = {
      kind: loaded.blockage_kind,
      subBranch: loaded.sub_branch as BlockageSelection["sub_branch"],
      withEvidence: loaded.status === "analyzed",
    };
    dispatch({ type: "sessionLoaded", status: loaded.status });
  }, [enterAnalysis]);

  // 열어 본 결과를 화면에 적는다. 목록에서 여는 길과 주소로 여는 길이 이것을 함께
  // 쓴다 — 결과를 적는 이 대목에서 갈리는 것은 못 불러왔을 때의 문구뿐이라 그것만
  // 부르는 쪽에 남는다(loadFailed 는 여기까지 오지 않는다). 두 길이 그 밖에 저마다
  // 다르게 하는 일은 이 함수보다 앞에 있다.
  const applyLoadOutcome = useCallback(
    (result: Exclude<SessionLoadOutcome, { kind: "loadFailed" }>, id: string) => {
      switch (result.kind) {
        case "analyzing":
          trackAnalysis(id);
          return;
        case "note":
          // 옛 코드에서 이 둘은 노트 조회의 try 안에 있었다 — 여기서 터지면 노트가
          // 없는 것과 같은 길로 갔고, 그 경계를 그대로 둔다. 조회와 달리 사이에
          // 기다림이 없어 자리를 뺏길 틈도 없다.
          try {
            dispatch({ type: "noteLoaded", report: result.report });
            countStepOnce(id, "result");
          } catch {
            dispatch({ type: "noteLoaded", report: null });
            startConversationAfterAnalysis(id);
          }
          return;
        case "noNote":
          dispatch({ type: "noteLoaded", report: null });
          startConversationAfterAnalysis(id);
          return;
        // 훑어보기가 실패한 연습은 그 자리에서 멈추고 — 폴링도 코치도 부르지 않는다 —
        // 자리를 뺏긴 응답은 남의 화면을 건드리지 않는다. 둘을 한 자리로 접지 않는
        // 것은 무엇을 안 하는지가 서로 다른 까닭이기 때문이다.
        case "analysisFailed":
        case "superseded":
          return;
        default: {
          // 결과가 하나 늘면 여기서 걸린다 — 안 그러면 조용히 아무것도 안 한다.
          const unhandled: never = result;
          return unhandled;
        }
      }
    },
    [countStepOnce, startConversationAfterAnalysis, trackAnalysis],
  );

  const openSession = useCallback(async (id: string) => {
    const selected = sessions.find((session) => session.session_id === id);
    if (selected) {
      trackPracticeHistoryOpened(
        selected.status,
        reports.some((item) => item.practice_session_id === id),
        (Date.now() - Date.parse(selected.created_at)) / 86_400_000,
      );
    }
    // 올리던 영상을 두고 다른 연습으로 넘어가면 그 업로드는 갈 곳이 없다.
    discardPendingUpload();
    analysisControllerRef.current?.abort();
    setCurrentSession(id);
    coachCoordinatorRef.current = null;
    urlLoadedRef.current = id;
    replaceUrl(`/practice/new?session=${encodeURIComponent(id)}`);
    setDrawerOpen(false);
    setError(null);
    setDetail(null);
    // 분석 구간 진입은 조회가 끝난 뒤 enterAnalysis 가 알린다.
    reportProgress({ type: "reset" });
    setMessages([]);
    // 무엇을 열었는지 아직 모른다. 지금 화면에서 지난 연습의 흔적만 걷어낸다 —
    // 여기서 고르던 로컬 원본도 그 전이가 함께 버린다. 남겨 두면 화면이 그것을
    // 서버 주소보다 먼저 잡아 남의 영상을 틀게 된다.
    dispatch({ type: "sessionOpening" });
    setCoachOpening(false);
    coachIdRef.current = null;
    dialogueTurnCountRef.current = 0;
    practiceAnalyticsContextRef.current = null;
    const doneLoading = startWork("sessionLoading", id);
    try {
      const result = await loadPracticeSession({
        sessionId: id,
        isCurrent: () => isCurrentSession(id),
        onLoaded: showLoadedSession,
      });
      // 못 불러온 것을 아래 catch 로 합류시킨다. 화면을 옮기다 터진 것과 같은 문구를
      // 같은 가드로 띄우던 옛 자리를 그대로 두려는 것이고, 오류 처리기를 try 안에
      // 두지 않아 한 실패가 두 번 세어지지도 않는다.
      if (result.kind === "loadFailed") throw result.cause;
      applyLoadOutcome(result, id);
    } catch {
      // 그새 다른 연습으로 넘어갔으면 이 실패는 지금 화면과 상관이 없다 —
      // 안쪽 가드와 같은 이유이고, 여기만 빠져 있었다.
      if (isCurrentSession(id)) {
        setError("연습을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      // 남의 요청이 지금 화면의 로딩을 풀면 안 된다 — 그것을 묻는 자리가 여기서
      // 사라졌다. 이 조회가 켠 표시는 그 사이 다른 연습이 이어받았으면 이미 그쪽
      // 것이고, 끝맺음은 자기 것만 끈다.
      doneLoading();
    }
  }, [
    applyLoadOutcome,
    discardPendingUpload,
    isCurrentSession,
    reportProgress,
    reports,
    sessions,
    setCurrentSession,
    showLoadedSession,
    startWork,
  ]);

  // 주소에 ?session= 이 실려 오면(연습 기록 링크·새로고침) 그 세션을 연다.
  // 클릭으로 여는 경로는 openSession 이고, 이쪽은 첫 진입만 맡는다.
  useEffect(() => {
    if (!ready || !sessionParam || urlLoadedRef.current === sessionParam) return;
    urlLoadedRef.current = sessionParam;
    let cancelled = false;
    // cancelled 만으로는 부족하다 — effect 가 다시 도는 경우만 막는다. 기다리는 사이
    // 배우가 목록에서 다른 연습을 열었으면 그쪽이 지금 화면이고, 이 응답은 거기 닿으면
    // 안 된다. 자리가 비어 있는 첫 진입은 이 연습이 그것을 잡으러 온 경우라
    // 통과시킨다 — 그것을 가르는 것이 isCurrentOrFree 다.
    const superseded = () => cancelled || !sessionIsCurrentOrFree(sessionParam);
    void (async () => {
      try {
        const result = await loadPracticeSession({
          sessionId: sessionParam,
          isCurrent: () => !superseded(),
          onLoaded: (loaded) => {
            // 주소로 온 길은 자기 자리부터 잡는다 — 목록에서 여는 길은 조회 전에
            // 이미 잡고 들어온다. 자리를 세우는 것은 화면을 옮기기 전에 끝내 둔다.
            reportProgress({ type: "reset" });
            setCurrentSession(sessionParam);
            dialogueTurnCountRef.current = 0;
            coachCoordinatorRef.current = null;
            showLoadedSession(loaded);
          },
        });
        if (result.kind === "loadFailed") throw result.cause;
        applyLoadOutcome(result, sessionParam);
      } catch {
        if (!superseded()) setError("연습을 찾을 수 없어요.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    sessionParam,
    applyLoadOutcome,
    reportProgress,
    sessionIsCurrentOrFree,
    setCurrentSession,
    showLoadedSession,
  ]);

  const removeSession = useCallback(async () => {
    if (!activeId) return;
    const doneDeleting = startWork("deleting", activeId);
    try {
      await deletePracticeSession(activeId);
      resetToPrep();
      void refreshList();
    } catch {
      setError("연습을 지우지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      // 성공한 길은 resetToPrep 이 이미 놓고 갔다. 그때는 켠 것이 남아 있지 않아
      // 이 끝맺음이 아무 일도 하지 않는다.
      doneDeleting();
    }
  }, [activeId, resetToPrep, refreshList, startWork]);

  const noteBySession = useMemo(
    () => new Set(reports.map((r) => r.practice_session_id)),
    [reports],
  );
  const headlineBySession = useMemo(
    () => new Map(reports.map((r) => [r.practice_session_id, r.title])),
    [reports],
  );
  const running = useMemo(
    () => sessions.filter((s) => s.status === "created" || s.status === "analyzing"),
    [sessions],
  );
  const finished = useMemo(
    () => sessions.filter((s) => s.status === "analyzed" || s.status === "failed"),
    [sessions],
  );
  const toggleRail = useCallback(() => setRailOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const reselectVideo = useCallback(() => fileInputRef.current?.click(), []);
  const handleLogout = useCallback(() => {
    void logout().then(() => router.replace("/login"));
  }, [router]);

  if (!ready) return <div className="min-h-dvh bg-white" aria-busy="true" />;

  const questionCount = messages.filter((message) => message.role === "ai").length;
  const displayName = nickname ?? "배우";
  const visibleScene = {
    situation: detail?.situation ?? situation,
    character: detail?.character_context ?? character,
    goal: detail?.goal ?? goal,
  };

  const rail = (
    <SessionRail
      open={railOpen}
      onToggle={toggleRail}
      onNew={resetToPrep}
      onOpen={openSession}
      running={running}
      finished={finished}
      activeId={activeId}
      hasNote={noteBySession}
      headlines={headlineBySession}
      listError={listError}
      displayName={displayName}
      onLogout={handleLogout}
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
              onToggle={closeDrawer}
              onNew={resetToPrep}
              onOpen={openSession}
              running={running}
              finished={finished}
              activeId={activeId}
              hasNote={noteBySession}
              headlines={headlineBySession}
              listError={listError}
              displayName={displayName}
              onLogout={handleLogout}
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
          {activeId ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-black leading-4 tracking-[-0.03em]">
                {detail?.situation?.trim() || "새 연습"}
              </p>
              {body.kind === "chat" && questionCount > 0 ? (
                <p className="mt-0.5 truncate text-[11px] font-semibold leading-4 text-[#8b95a1] sm:hidden">
                  {questionOrdinal(questionCount)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col justify-center sm:contents">
              <p className="truncate text-[15px] font-black tracking-[-0.03em] sm:min-w-0 sm:flex-1">
                {detail?.situation?.trim() || "새 연습"}
              </p>
              <p className="truncate text-[11px] font-semibold text-[#8b95a1] sm:hidden">
                {NEW_PRACTICE_SUBTITLE}
              </p>
            </div>
          )}
          <StatusChip chip={view.statusChip} />
          {/* 오른쪽 끝은 한 덩어리로 묶는다 — ml-auto 를 두 군데 주면 남는 폭을 나눠 갖는다. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {activeId ? (
              <>
                <button
                  type="button"
                  disabled={busyDisabled.remove}
                  onClick={() => void removeSession()}
                  className="hidden h-8 rounded-[10px] border border-[#f1aeb5] px-3 text-xs font-black text-[#e03131] transition hover:bg-[#fff5f5] disabled:text-[#f1aeb5] sm:block"
                >
                  삭제
                </button>
                {reviewArmed ? (
                  <button
                    type="button"
                    onClick={openReview}
                    aria-label="연습 마치기"
                    title="연습 마치기"
                    className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f2f4f6] text-sm font-black text-[#4e5968] transition hover:bg-[#e5e8eb]"
                  >
                    ✕
                  </button>
                ) : null}
              </>
            ) : (
              <span className="hidden text-xs font-semibold text-[#8b95a1] sm:block">
                {NEW_PRACTICE_SUBTITLE}
              </span>
            )}
            {/* 좌측 레일을 걷어내고(2026-08-09) 그 길을 이 바 오른쪽 끝으로 옮겼다.
                연습이 열려 있는 폰 화면에서는 숨긴다 — 삭제·마치기·상태칩까지 한 줄에
                서면 375px에서 제목에 40px밖에 안 남는다. */}
            <nav
              aria-label="주요 메뉴"
              className={`items-center gap-1 border-l border-[#edf0f3] pl-2 ${
                activeId ? "hidden sm:flex" : "flex"
              }`}
            >
              <Link
                href="/admissions"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                입시
              </Link>
              <Link
                href="/community"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                커뮤
              </Link>
              {/* 코치가 나에 대해 적어 둔 것. 틀린 내용을 되돌릴 수 있는 유일한
                  자리라 숨기지 않는다. */}
              <Link
                href="/memory"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                기억
              </Link>
              {/* 앱은 폰에서 받는 것이라, 이 줄이 폰에서 숨는 상황(연습이 열려 있을 때)은
                  드로어 하단이 대신 받는다. 옆 항목들과 달리 파란 글씨인 이유는 갓 나온
                  길이라 눈에 걸려야 해서다. */}
              <Link
                href="/app"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#3182f6] transition hover:bg-[#e8f3ff]"
              >
                앱
              </Link>
            </nav>
          </div>
        </header>

        {body.kind === "chat" || body.kind === "note" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:flex-row">
            <ScenePanel
              detail={detail}
              open={scenePanelOpen}
              onToggle={() => setScenePanelOpen((v) => !v)}
            />
            {body.kind === "note" ? (
              <NotePanel
                report={body.report}
                messages={messages}
                backDisabled={busyDisabled.backToChat}
                onBackToChat={
                  body.backTo === "restart"
                    ? restartAfterBlocked
                    : () => dispatch({ type: "chatReopened" })
                }
                onFinish={openReview}
                onContinueNext={continueFromCurrent}
              />
            ) : (
              <ChatPanel
                key={activeId ?? "new"}
                messages={messages}
                answer={answer}
                setAnswer={setAnswer}
                sending={sending || coachOpening}
                inputEnabled={isCoachInputEnabled({
                  coachReady: body.coachReady,
                  sending,
                })}
                error={error}
                scrollRef={chatScrollRef}
                onSend={(reply) => void send(reply)}
                done={body.done}
                noteReady={body.noteReady}
                onOpenNote={openNote}
              />
            )}
          </div>
        ) : body.kind === "blockage" ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7faff] px-4 py-6 sm:px-5 sm:py-8">
            <div className="mx-auto w-full max-w-[760px]">
              <BlockageSelectionFlow
                videoUrl={body.videoUrl}
                scene={{ situation, character, goal }}
                busy={busyDisabled.blockageSubmit}
                onComplete={(selection) => void begin(selection)}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-5 sm:py-8">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 sm:gap-6">
              <Stepper current={body.step} />
              {body.continueBanner ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#e8f3ff] px-4 py-3">
                  <p className="text-sm font-bold leading-6 text-[#1b64da]">
                    {body.continueBanner.label
                      ? `「${body.continueBanner.label}」 연습의 대화를 이어받아요`
                      : "지난 연습의 대화를 이어받아요"}
                  </p>
                  {body.continueBanner.dismissible ? (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "continueDeclined" })}
                      className="shrink-0 text-xs font-black text-[#8b95a1] transition hover:text-[#4e5968]"
                    >
                      이어받지 않기
                    </button>
                  ) : null}
                </div>
              ) : null}
              {body.video.kind === "player" ? (
                <VideoBox
                  src={body.video.src}
                  caption={body.video.caption}
                  onDuration={(durationMs) =>
                    reportProgress({ type: "duration", videoDurationMs: durationMs })
                  }
                  onReselect={body.video.reselectable ? reselectVideo : undefined}
                />
              ) : body.video.kind === "upload-zone" ? (
                <UploadZone onClick={() => fileInputRef.current?.click()} />
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
              />
              <SceneForm
                situation={visibleScene.situation}
                character={visibleScene.character}
                goal={visibleScene.goal}
                locked={body.sceneLocked}
                onSituation={setSituation}
                onCharacter={setCharacter}
                onGoal={setGoal}
              />
              {body.footer.kind === "start" ? (
                <StartRow
                  ready={body.footer.ready}
                  onStart={() => {
                    const picked = screen.kind === "prep" ? screen.video : null;
                    if (!picked) return;
                    startUpload(picked.file);
                    dispatch({ type: "blockageChosen" });
                    trackPracticeBlockageStarted();
                  }}
                />
              ) : body.footer.phase === "upload" ? (
                <ProgressPanel
                  pct={pct}
                  durationMs={videoDurationMs}
                  phase="upload"
                  pastDeadline={false}
                />
              ) : (
                <ProgressPanel
                  pct={pct}
                  durationMs={videoDurationMs}
                  phase="scan"
                  pastDeadline={pastDeadline}
                  failed={body.footer.failed}
                  starting={coachOpening}
                  onStartWithoutEvidence={() => {
                    if (activeId) startConversationWithoutEvidence(activeId);
                  }}
                />
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

      {reviewTrigger ? (
        <ExitReviewModal
          trigger={reviewTrigger}
          onClose={onReviewClose}
          onSubmitted={markReviewDone}
        />
      ) : null}
    </div>
  );
}

/* ── 왼쪽 세션 바 ─────────────────────────────────────────────── */

const SessionRail = memo(function SessionRail({
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
  // 이어한 연습(continued_from)을 부모 밑에 차수로 묶는다 (SOMA-418). 부모가 목록에
  // 없으면(숨김 등) 자식을 낱개로 승격한다 — 고아를 빈 묶음에 매달면 접근이 사라진다.
  const finishedIds = new Set(finished.map((s) => s.session_id));
  const childrenByRoot = new Map<string, PracticeSessionListItem[]>();
  const roots: PracticeSessionListItem[] = [];
  for (const s of finished) {
    const parent = s.continued_from;
    if (parent && parent !== s.session_id && finishedIds.has(parent)) {
      childrenByRoot.set(parent, [...(childrenByRoot.get(parent) ?? []), s]);
    } else {
      roots.push(s);
    }
  }
  childrenByRoot.forEach((list) =>
    list.sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
  // 묶음은 가장 최근 차수 기준으로 띄운다 — 어제 이어한 묶음이 목록 바닥에 있으면 못 찾는다.
  const newestOf = (s: PracticeSessionListItem) => {
    const kids = childrenByRoot.get(s.session_id);
    return kids?.length ? kids[kids.length - 1].created_at : s.created_at;
  };
  roots.sort((a, b) => newestOf(b).localeCompare(newestOf(a)));
  // 묶음은 기본으로 접는다 — 차수가 쌓일수록 목록이 길어져 다른 연습이 밀려난다.
  // 지금 열려 있는 연습이 속한 묶음은 항상 펼친다: 접혀 있으면 내가 어디 있는지 안 보인다.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (rootId: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
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
                  meta={`같이 볼 장면을 찾고 있어요 · ${whenLabel(s.created_at)}`}
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
              roots.map((s) => (
                <div key={s.session_id}>
                  <RailItem
                    // ?? 는 빈 문자열을 통과시킨다 — 상황을 안 적은 세션이 제목 없이 렌더됐다.
                    // 진행 중 목록(위)은 || 를 써서 여기만 어긋나 있었다.
                    title={headlines.get(s.session_id)?.trim() || s.situation?.trim() || "제목 없는 연습"}
                    meta={`${whenLabel(s.created_at)}${hasNote.has(s.session_id) ? " · 문장 남김" : ""}`}
                    active={s.session_id === activeId}
                    onClick={() => onOpen(s.session_id)}
                  />
                  {(() => {
                    const kids = childrenByRoot.get(s.session_id) ?? [];
                    if (kids.length === 0) return null;
                    const opened = openGroups.has(s.session_id)
                        || kids.some((child) => child.session_id === activeId);
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleGroup(s.session_id)}
                          className="ml-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-black text-[#8b95a1] transition hover:bg-[#eef2f6] hover:text-[#4e5968]"
                        >
                          <span
                            aria-hidden="true"
                            className={`inline-block transition-transform ${opened ? "rotate-90" : ""}`}
                          >
                            ▸
                          </span>
                          {opened ? "이어한 연습 접기" : `이어한 연습 ${kids.length}개 펼치기`}
                        </button>
                        {opened
                          ? kids.map((child, index) => (
                              <div
                                key={child.session_id}
                                className="ml-4 border-l-2 border-[#e5e8eb] pl-1.5"
                              >
                                <RailItem
                                  title={headlines.get(child.session_id)?.trim() || `${index + 2}차 연습`}
                                  meta={`${index + 2}차 · ${whenLabel(child.created_at)}${
                                    hasNote.has(child.session_id) ? " · 문장 남김" : ""
                                  }`}
                                  active={child.session_id === activeId}
                                  onClick={() => onOpen(child.session_id)}
                                />
                              </div>
                            ))
                          : null}
                      </>
                    );
                  })()}
                </div>
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

      {/* 커뮤니티·입시로 나가는 길은 위 헤더 오른쪽 끝이 맡는다. 여기 두면 두 군데가 된다.
          앱 다운로드만 예외로 드로어에 둔다 — 폰에서 연습이 열려 있으면 헤더 오른쪽 줄이
          통째로 숨어서(375px에 제목 자리가 안 남는다) 앱으로 가는 길이 사라진다.
          데스크톱 레일에는 넣지 않는다. 헤더가 이미 보이는 자리라 두 군데가 된다. */}
      {drawer ? (
        <Link
          href="/app"
          className="mt-auto flex items-center gap-3 border-t border-[#edf0f3] px-4 py-3.5 transition hover:bg-[#eef2f6]"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#e8f3ff] text-[15px] font-black text-[#3182f6]"
          >
            ↓
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-black text-[#191f28]">앱 다운로드</span>
            <span className="block text-[11px] font-semibold text-[#8b95a1]">
              iOS · Android
            </span>
          </span>
        </Link>
      ) : null}

      <div
        className={`flex items-center border-t border-[#edf0f3] ${drawer ? "" : "mt-auto"} ${
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
});

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

/* ── 준비 화면 ────────────────────────────────────────────────── */

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

const VideoBox = memo(function VideoBox({
  src,
  caption,
  onDuration,
  onReselect,
}: {
  src: string;
  caption: string;
  onDuration?: (durationMs: number) => void;
  onReselect?: () => void;
}) {
  return (
    <div>
      <video
        src={src}
        controls
        playsInline
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (onDuration && Number.isFinite(seconds) && seconds > 0) {
            onDuration(Math.round(seconds * 1000));
          }
        }}
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
});

const SceneForm = memo(function SceneForm({
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
      className="rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)] sm:rounded-[20px] sm:p-6"
    >
      <h2 className="text-[15px] font-black tracking-[-0.03em] sm:text-base">
        이 장면에서 무엇을 연기했는지 알려 주세요
      </h2>
      <div className="mt-3 grid gap-3">
        <SceneField label="상황" value={situation} onChange={onSituation} disabled={locked} placeholder="이별을 통보받은 직후, 카페에서" />
        <SceneField label="인물" value={character} onChange={onCharacter} disabled={locked} placeholder="담담한 척하는 20대 후반 여성" />
        <SceneField label="목표" value={goal} onChange={onGoal} disabled={locked} placeholder="상대가 마음을 돌려 다시 앉게 만들기" />
      </div>
    </section>
  );
});

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
        readOnly={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8fbff] px-3.5 text-base font-semibold text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff] read-only:cursor-default read-only:focus:border-[#e5e8eb] read-only:focus:bg-[#f8fbff] read-only:focus:ring-0"
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

function ProgressPanel({
  pct,
  durationMs,
  phase,
  pastDeadline,
  failed = false,
  starting = false,
  onStartWithoutEvidence,
}: {
  pct: number;
  durationMs: number | null;
  phase: "upload" | "scan";
  /**
   * 분석 목표 시간을 넘겼는가. 진행률 훅이 정해서 내려 준다.
   * 기본값을 두지 않는다 — 두면 호출부에서 이 줄이 사라져도 아무도 모른다.
   */
  pastDeadline: boolean;
  failed?: boolean;
  starting?: boolean;
  onStartWithoutEvidence?: () => void;
}) {
  if (failed) {
    return (
      <div aria-live="polite" className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)] sm:p-6">
        <h2 className="text-lg font-black leading-7 text-[#191f28]">
          영상을 바탕으로 질문을 준비하지 못했어요
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
          원하면 영상 근거 없이 대화를 시작할 수 있어요.
        </p>
        <button
          type="button"
          disabled={starting}
          onClick={onStartWithoutEvidence}
          className="mt-5 min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#3182f6] disabled:bg-[#b0d2ff]"
        >
          {starting ? "질문 준비 중…" : "그냥 시작"}
        </button>
      </div>
    );
  }

  const duration = formatVideoDuration(durationMs);
  const waitingLabel = pastDeadline
    ? "평소보다 오래 걸리고 있어요 · 장면을 계속 살펴보고 있어요…"
    : duration
      ? `${duration} 영상 · 장면을 훑어보고 있어요…`
      : "영상 길이 확인 · 장면을 훑어보고 있어요…";
  const value = Math.round(pct);
  const width = Math.min(100, Math.max(0, pct));
  const label = phase === "upload" ? "영상 올리는 중…" : waitingLabel;

  return (
    <div aria-live="polite" className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)] sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-xl font-black tabular-nums tracking-[-0.04em] text-[#3182f6]">
          {value}%
        </span>
        <span className="text-xs font-semibold text-[#4e5968] sm:text-[13px]">
          {label}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${value}% ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8f3ff]"
      >
        <div
          className="h-full rounded-full bg-[#3182f6] transition-[width] duration-300"
          style={{ width: `${width}%` }}
        />
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileVideoRef = useRef<HTMLVideoElement | null>(null);
  const rows: [string, string][] = [
    ["상황", detail?.situation?.trim() || "적지 않았어요"],
    ["인물", detail?.character_context?.trim() || "적지 않았어요"],
    ["목표", detail?.goal?.trim() || "적지 않았어요"],
  ];
  const blockage = [detail?.blockage_kind?.trim(), detail?.sub_branch?.trim()]
    .filter(Boolean)
    .join(" › ") || "적지 않았어요";
  const mobileRows: [string, string][] = [...rows, ["막힌 곳", blockage]];
  const observations = detail?.summary?.observations ?? [];
  const blockageDetail = detail?.blockage_detail?.trim();

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const playObservation = (startMs: number) => {
    const video = mobileVideoRef.current;
    if (!video) return;
    video.currentTime = startMs / 1000;
    void video.play().catch(() => {});
  };

  return (
    <>
      {/* 폰: 대화 위 접이식 스트립 한 줄.
          화면이 낮으면 감춘다 — 안드로이드는 키보드가 뜨면 뷰포트가 380px대로 줄어드는데,
          이 줄이 남아 있으면 질문이 밀려 나가 답을 쓰는 동안 질문을 못 본다.
          키보드가 내려가면 다시 나온다. (iOS는 뷰포트가 안 줄어 해당 없음) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex shrink-0 items-center gap-2.5 overflow-hidden rounded-[16px] bg-[#f9fafb] px-3 py-2.5 text-left lg:hidden [@media(max-height:560px)]:hidden"
      >
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
      </button>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-[#0f141e]/45 lg:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setMobileOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="영상과 장면 보기"
            className="max-h-[calc(100dvh-12px)] w-full overflow-y-auto rounded-t-[24px] bg-white p-4"
          >
            {detail?.playback_url ? (
              <video
                ref={mobileVideoRef}
                key={detail.playback_url}
                src={detail.playback_url}
                controls
                preload="metadata"
                className="aspect-video w-full rounded-xl bg-black object-contain"
              />
            ) : null}
            {observations.length > 0 ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-[13.5px] font-black">관찰 시점</p>
                  <p className="text-[11.5px] font-semibold text-[#8b95a1]">
                    누르면 그 구간부터 재생돼요
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {observations.map((observation, index) => (
                    <button
                      key={`${observation.start_ms}-${index}`}
                      type="button"
                      onClick={() => playObservation(observation.start_ms)}
                      className="rounded-full bg-[#e8f3ff] px-3 py-1.5 text-xs font-black tabular-nums text-[#1b64da]"
                    >
                      {formatObservationTime(observation.start_ms)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <SceneRows rows={mobileRows} />
            {blockageDetail ? (
              <div className="mt-4">
                <p className="text-[11.5px] font-black text-[#8b95a1]">내가 막힌다고 쓴 글</p>
                <blockquote className="mt-1 break-words rounded-[16px] bg-[#f8fbff] px-4 py-3 text-[12.5px] font-semibold leading-5 text-[#333d4b]">
                  {blockageDetail}
                </blockquote>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-[10px] bg-[#f2f4f6] text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
            >
              접기
            </button>
          </div>
        </div>
      ) : null}

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

function formatObservationTime(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  inputEnabled,
  error,
  scrollRef,
  onSend,
  done,
  noteReady,
  onOpenNote,
}: {
  messages: ChatMsg[];
  answer: string;
  setAnswer: (v: string) => void;
  sending: boolean;
  inputEnabled: boolean;
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: (reply?: string) => void;
  done: boolean;
  noteReady: boolean;
  onOpenNote: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const firstQuestionIndex = messages.findIndex((message) => message.role === "ai");
  const dialogueMessages = firstQuestionIndex >= 0 ? messages.slice(firstQuestionIndex) : [];
  const currentQuestionIndex = dialogueMessages.findLastIndex((message) => message.role === "ai");
  const currentQuestion = currentQuestionIndex >= 0 ? dialogueMessages[currentQuestionIndex] : null;
  const pastMessages = currentQuestionIndex >= 0
    ? dialogueMessages.slice(0, currentQuestionIndex)
    : [];
  const pastPairCount = pastMessages.filter((message) => message.role === "me").length;
  const questionCount = dialogueMessages.filter((message) => message.role === "ai").length;

  const sendPreset = (reply: string) => {
    setAnswer(reply);
    onSend(reply);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_12px_36px_rgba(25,31,40,0.06)] sm:rounded-[20px]">
      {done ? (
        <div className="flex items-center gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#03b26c]" />
            {done ? "이번 대화는 여기까지예요" : "현재 장면을 바탕으로 질문하고 있어요"}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-3 border-b border-[#edf0f3] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-1.5">
            {Array.from({ length: questionCount }, (_, index) => (
              <span key={index} className="h-1 w-4 rounded-full bg-[#3182f6]" />
            ))}
          </div>
          <p className="shrink-0 text-xs font-black text-[#4e5968] sm:text-[13.5px]">
            {questionOrdinal(Math.max(1, questionCount))}
          </p>
          {pastPairCount > 0 ? (
            <button
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
              className="ml-auto shrink-0 text-xs font-black text-[#8b95a1]"
            >
              지난 문답 {pastPairCount} ▾
            </button>
          ) : null}
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        aria-label="질문과 답변"
        className="flex min-h-0 flex-1 flex-col px-4 sm:px-5"
      >
        {historyOpen && pastPairCount > 0 ? (
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto border-b border-[#edf0f3] py-4"
          >
            <div className="flex flex-col gap-3 sm:gap-4">
              {pastMessages.map((message, index) => (
                <Bubble key={`${message.role}-${index}`} msg={message} />
              ))}
            </div>
          </div>
        ) : null}
        {/* shrink-0 을 쓰면 안 된다 — 안드로이드는 키보드가 뜨면 레이아웃 뷰포트가
            줄어드는데, 그때 질문이 줄지 못하고 넘쳐 입력칸 위로 겹쳐 그려졌다.
            (iOS 사파리는 뷰포트가 안 줄어서 이 증상이 안 보인다, 2026-08-13 실측) */}
        <div className="min-h-0 shrink overflow-y-auto py-5 sm:py-7 [@media(max-height:560px)]:py-2">
          {/* 낮은 화면(안드로이드 키보드)에서는 두 줄로 깔끔하게 자른다 —
              그냥 스크롤로 두면 글자가 반 줄에서 잘려 깨진 것처럼 보인다.
              키보드를 내리면 전문이 다시 보인다. */}
          {currentQuestion ? (
            <h2 className="whitespace-pre-wrap text-2xl font-black leading-[1.4] tracking-[-0.035em] text-[#191f28] sm:text-[28px] [@media(max-height:560px)]:line-clamp-2">
              {currentQuestion.text}
            </h2>
          ) : null}
          {sending ? (
            <div className="mt-4 flex items-end gap-2">
              <div className="rounded-[18px] rounded-bl-[6px] bg-[#f7faff] px-4 py-3">
                <WaitingDots />
              </div>
            </div>
          ) : null}
        </div>
        {/* 남는 높이는 질문 아래로 흘린다 — 위에 두면 질문이 입력칸까지 밀려 내려간다.
            지난 문답을 펼쳤을 때는 그 영역이 남는 높이를 다 가져야 해서 두지 않는다. */}
        {historyOpen && pastPairCount > 0 ? null : <div className="min-h-0 flex-1" />}
      </div>

      <div className="border-t border-[#edf0f3] p-3 sm:p-3.5">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <p role="status" className="text-sm font-semibold text-[#4e5968]">
              {noteReady ? "지금까지 이야기한 걸 정리해 뒀어요." : "정리하고 있어요…"}
            </p>
            <button
              type="button"
              onClick={onOpenNote}
              disabled={!noteReady}
              className="min-h-12 w-full rounded-2xl bg-[#3182f6] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] sm:w-auto sm:min-w-[220px]"
            >
              정리보기
            </button>
          </div>
        ) : (
          <div className="grid gap-2.5">
            <div className="relative">
              <textarea
                value={answer}
                disabled={!inputEnabled}
                maxLength={300}
                rows={3}
                placeholder="답을 편하게 적어 주세요"
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                    && (event.metaKey || event.ctrlKey)
                    && !event.nativeEvent.isComposing
                    && answer.trim()
                    && inputEnabled
                  ) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                className="h-[104px] w-full resize-none rounded-[16px] border border-[#e5e8eb] bg-[#f8fbff] px-4 pb-3 pt-8 text-base font-semibold outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white disabled:bg-[#f2f4f6]"
              />
              <span className="pointer-events-none absolute right-4 top-3 text-[11.5px] font-semibold tabular-nums text-[#8b95a1]">
                {answer.length} / 300
              </span>
            </div>
            {/* 낮은 화면(안드로이드 키보드)에서는 접는다 — 답을 쓰기 시작한 뒤에 누르는 것이
                아니라 막혔을 때 누르는 버튼이라, 질문 자리를 내주는 편이 낫다. */}
            <div className="grid grid-cols-2 gap-2.5 [@media(max-height:560px)]:hidden">
              <button
                type="button"
                onClick={() => sendPreset("잘 모르겠어요")}
                disabled={sending || !inputEnabled}
                className="h-10 rounded-[10px] bg-[#f2f4f6] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6] disabled:text-[#b0b8c1]"
              >
                잘 모르겠어요
              </button>
              <button
                type="button"
                onClick={() => sendPreset("제가 되물을게요")}
                disabled={sending || !inputEnabled}
                className="h-10 rounded-[10px] bg-[#f2f4f6] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#eef2f6] disabled:text-[#b0b8c1]"
              >
                제가 되물을게요
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSend()}
              disabled={sending || !inputEnabled || !answer.trim()}
              className="min-h-12 w-full rounded-[16px] bg-[#3182f6] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]"
            >
              이 답으로 다음 질문 →
            </button>
            <p className="text-xs font-semibold text-[#8b95a1] [@media(max-height:560px)]:hidden">
              &apos;그만&apos;이라고 쓰면 언제든 마칠 수 있어요
            </p>
          </div>
        )}
      </div>
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

// 노트 없이는 이 자리에 설 수 없다 — 화면이 자기 노트를 들고 있고(workspace-state.ts)
// 그것을 그대로 받는다. 옛 코드는 노트가 없을 때의 자리("정리하는 중이에요…")를 여기
// 두었는데, 화면이 노트를 들게 된 뒤로는 그 자리에 닿을 길이 없어졌다.
function NotePanel({
  report,
  messages,
  backDisabled,
  onBackToChat,
  onFinish,
  onContinueNext,
}: {
  report: PracticeReport;
  messages: ChatMsg[];
  /** 뒤에서 도는 일이 대화로 돌아가는 길을 막고 있는가. */
  backDisabled: boolean;
  onBackToChat: () => void;
  onFinish: () => void;
  onContinueNext: () => void;
}) {
  if (report.report_type === "blocked") {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7faff] p-4 sm:p-5">
          <div className="grid gap-4 rounded-[24px] bg-white p-5 shadow-[0_12px_36px_rgba(25,31,40,0.06)]">
            <div>
              <p className="text-xs font-black text-[#3182f6]">지금까지 나눈 이야기</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">대화에서 찾은 내용을 먼저 모아 뒀어요</h2>
            </div>
            <div className="grid gap-3">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className="rounded-2xl bg-[#f8fbff] px-4 py-3">
                  <p className="text-xs font-black text-[#8b95a1]">{message.role === "me" ? "나" : "코치"}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#333d4b]">{message.text}</p>
                </div>
              ))}
            </div>
            <p className="rounded-2xl bg-[#e8f3ff] px-4 py-3 text-sm font-bold leading-6 text-[#1b64da]">
              지금까지 나눈 이야기는 연습 노트로 남지 않아요. 다시 대화하면 이 내용은 사라지고 처음부터 시작해요.
            </p>
          </div>
        </div>
        <div className="flex gap-2.5 border-t border-[#edf0f3] p-3.5 sm:p-4">
          <button
            type="button"
            onClick={onFinish}
            className="h-12 flex-1 rounded-[14px] bg-[#f8fbff] text-sm font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
          >
            연습 마치기
          </button>
          <button
            type="button"
            disabled={backDisabled}
            onClick={onBackToChat}
            className="h-12 flex-1 rounded-[14px] bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#c9d3df]"
          >
            처음부터 다시 대화하기
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7faff] p-4 sm:p-5">
        <PracticeReportCards report={report} />
      </div>

      <div className="grid gap-2.5 border-t border-[#edf0f3] p-3.5 sm:p-4">
        {/* 새 영상을 올려도 코치가 이 연습의 대화를 이어받는다 (SOMA-417) */}
        <button
          type="button"
          onClick={onContinueNext}
          className="h-12 rounded-[14px] bg-[#e8f3ff] text-sm font-black text-[#1b64da] transition hover:bg-[#d8eaff]"
        >
          이 연습에 이어서 새 연습
        </button>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onBackToChat}
            className="h-12 flex-1 rounded-[14px] bg-[#f8fbff] text-sm font-black text-[#4e5968] transition hover:bg-[#eef2f6]"
          >
            대화 다시 보기
          </button>
          {/* 헤더의 마치기와 같은 후기 창을 연다 — 새 창으로 새면 남겼는지 알 수 없다 */}
          <button
            type="button"
            onClick={onFinish}
            className="h-12 flex-1 rounded-[14px] bg-[#3182f6] text-sm font-black text-white transition hover:bg-[#1b64da]"
          >
            연습 마치기
          </button>
        </div>
      </div>
    </section>
  );
}

function StatusChip({ chip }: { chip: WorkspaceStatusChip | null }) {
  if (!chip) return null;
  const map: Record<WorkspaceStatusChip, [string, string]> = {
    uploading: ["업로드 중", "bg-[#e8f3ff] text-[#3182f6]"],
    analyzing: ["질문 준비", "bg-[#e8f3ff] text-[#3182f6]"],
    chat: ["질문 대화 중", "bg-[#e8f3ff] text-[#3182f6]"],
    "chat-done": ["대화 마침", "bg-[#e5f8ef] text-[#009959]"],
    note: ["연습 노트", "bg-[#e5f8ef] text-[#009959]"],
  };
  const [label, tone] = map[chip];
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
