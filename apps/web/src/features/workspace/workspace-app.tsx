"use client";

import { CoachComposer } from "./coach-composer";

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
import { useSearchParams } from "next/navigation";
import wordmark from "@/assets/acttub-wordmark.png";
import { GUEST_BROWSER_ONLY_NOTICE } from "@/features/consent/guest-notice";
import { useGuestSession } from "@/features/consent/use-guest-session";
import {
  conversationErrorMessage,
  getConversation,
  isConversationConflict,
  replyConversation,
  startConversation,
} from "@/lib/api/v2/coach-conversations";
import { getPracticeNote } from "@/lib/api/v2/notes";
import { errorMessage } from "@/lib/api/v2/errors";
import { coachReplyError, isClosedCoach, recoverClosedCoach } from "./coach-reply-recovery";
import {
  cancelPractice,
  listPracticeGroups,
  pollPracticeUntilSettled,
  reanalyzeSession,
} from "@/lib/api/v2/practices";
import { getVideo } from "@/lib/api/v2/videos";
import type { PracticeGroup } from "@/lib/practice/api-types";
import { newRequestId } from "@/lib/reading/request-id";
import type { Conversation, ConversationTurnResponse } from "@/lib/practice/api-types";
import {
  actorTurnCount,
  conversationLines,
  isConversationDone,
  needsTurnHistory,
} from "../practice/conversation-view";
import {
  trackDialogueStarted,
  trackResultViewed,
  trackVideoUploaded,
} from "@/lib/analytics/ga";
import {
  trackPracticeAbandoned,
  trackPracticeAnalysisSettled,
  trackPracticeBlockageSubmitted,
  trackPracticeDialogueCompleted,
  trackPracticeDialogueStartFailed,
  trackPracticeDialogueStarted,
  trackPracticeDialogueTurnFailed,
  trackPracticeDialogueTurnSent,
  trackPracticeHistoryOpened,
  trackPracticePrepOpened,
  trackPracticeResultViewed,
  trackPracticeSceneSkipped,
  trackPracticeSessionCreated,
  trackPracticeUploadFailed,
  trackPracticeUploadProfiled,
  trackPracticeVideoSelected,
} from "@/lib/analytics/amplitude";
import { ExitReviewModal, useExitReview } from "./exit-review";
import { feedbackScreen } from "./exit-survey";
import { BlockageFields } from "../practice/blockage-selection";
import {
  completeBlockageFlowWithDefault,
  initialBlockageFlowState,
  type BlockageFlowState,
  type BlockageSelection,
} from "../practice/blockage-flow";
import { analysisNotice, sessionStatusOf } from "../practice/practice-analysis";
import { isBlockedReport, reportTypeOf } from "../practice/practice-note";
import { practiceToSessionDetail, type PracticeDetailView } from "../practice/practice-view";
import {
  ALL_FILTER_LABEL,
  byMonth,
  CONTINUE_NEW_VIDEO_LABEL,
  CONTINUE_SAME_VIDEO_LABEL,
  groupOfPractice,
  groupTitle,
  HIDE_GROUP_COPY,
  inProgressPracticeId,
  railGroups,
  recent30,
  RECENT_FILTER_LABEL,
  UNTITLED_PRACTICE,
  type RailGroup,
} from "../practice/practice-groups";
import { guardUnfinishedUpload } from "./upload-exit-guard";
import { guestAnalysisNotice, guestAnalysisUsed, recordGuestAnalysis } from "../practice/guest-daily-limit";
import {
  createCoachStartCoordinator,
  type CoachStartCoordinator,
  isCoachInputEnabled,
} from "../practice/coach-contract";
import { WaitingDots } from "../practice/waiting-dots";
import { PreviousConversations } from "../practice/previous-conversations";
import { PracticeReportCards } from "../practice/practice-report-cards";
import {
  formatVideoDuration,
  isSceneContextBlank,
  SCENE_FIELD_MAX,
  sceneContextTooLong,
  type SceneContextDraft,
} from "../practice/practice-setup-flow";
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
import { removePractice } from "./practice-removal";
import {
  loadPracticeSession,
  type SessionLoadOutcome,
} from "./session-loading";
import {
  abandonedStage,
  currentReport,
  type PracticeReport,
  initialWorkspaceScreen,
  isLocalVideo,
  pickedVideo,
  workspaceScreenReducer,
  type ContinueFrom,
  type LibraryVideo,
  type WorkspaceScreen,
} from "./workspace-state";
import {
  describeWorkspaceView,
  type WorkspaceStatusChip,
} from "./workspace-view";
import { videoRecordRows } from "@/features/practice/video-record-rows";

const NEW_PRACTICE_SUBTITLE = "영상을 올리면 질문이 시작돼요";
/** 같은 영상으로 이어할 때 준비 화면이 드는 보관함 영상의 설명 */
const SAME_VIDEO_CAPTION = "지난 회차와 같은 영상";
const LIBRARY_VIDEO_CAPTION = "보관함 영상";

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
// 업로드가 끝나는 지점에서 새로고침처럼 보이던 게 이것이다.
function replaceUrl(path: string): void {
  window.history.replaceState(null, "", path);
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
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  // 웹에는 로그인이 없다. 이 화면은 누구에게나 열리고, 게스트 계정은 배우가 영상을
  // 올리려 할 때 공용 클라이언트가 만든다(account.guest). 게스트가 없는 동안에는 볼
  // 자료도 없으므로 아래 조회들은 서버에 묻지 않는다.
  const { hasSession } = useGuestSession();
  const initialPrepTrackedRef = useRef(false);

  useEffect(() => {
    if (initialPrepTrackedRef.current) return;
    initialPrepTrackedRef.current = true;
    trackPracticePrepOpened("new");
  }, []);

  // ── 왼쪽 세션 바 ────────────────────────────────────────────────
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  const [listError, setListError] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scenePanelOpen, setScenePanelOpen] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const { groups: loaded } = await listPracticeGroups();
      setGroups(loaded);
      setListError(false);
    } catch {
      setListError(true);
    }
  }, []);

  // 목록은 이펙트 안에서 직접 불러온다. setState 가 await 뒤에서만 일어나야 하고
  // (동기 setState 는 연쇄 렌더를 만든다), 화면을 떠나면 늦게 온 응답을 버려야 한다.
  //
  // useResource 로 접히지 않는다 — 같은 답을 세우는 길이 둘이다(첫 진입인 여기, 그리고
  // 연습을 만들거나 지운 뒤 부르는 위 refreshList). 훅이 답을 들면 그 갈아 끼우기를
  // 밖에서 할 수 없다 (SOMA-411).
  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    void (async () => {
      try {
        const { groups: loaded } = await listPracticeGroups();
        if (cancelled) return;
        setGroups(loaded);
        setListError(false);
      } catch {
        if (!cancelled) setListError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSession]);

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
  const [detail, setDetail] = useState<PracticeDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 게스트의 하루 3회 분석 한도. 시작 전에 알린다(practice.start). 서버가 정본이고 기기는 오늘 세어 둔 것만 보인다.
  const [guestUsed, setGuestUsed] = useState(0);
  useEffect(() => {
    setGuestUsed(guestAnalysisUsed());
  }, []);
  // 묶음 숨김 확인. "삭제"는 1.0.0 부터 묶음 숨김이다 — 노트·대화·기억은 남고 영상은 보관함에 남는다.
  const [hideConfirm, setHideConfirm] = useState(false);
  /** 기록 목록의 최근 30일 필터. 켠 시각을 들고 있다가 그 시각을 기준으로 자른다(practice.library). */
  const [recentOnly, setRecentOnly] = useState<Date | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** 같은 본문의 시작 요청은 같은 요청 id 를 다시 쓴다 — 실패 뒤 다시 눌러도 회차가 하나다. */
  const startRequestRef = useRef<{ key: string; id: string } | null>(null);
  /** 409 practice_in_progress 뒤 그 회차로 돌아가는 길. openSession 이 아래에서 정해지므로 ref 로 잇는다. */
  const returnToInProgressRef = useRef<(rootId?: string) => Promise<void>>(async () => {});

  // 준비 순서 입력. 고른 영상은 화면이 들고 있다 — 어느 자리까지 따라오는지가
  // 그 자리의 타입으로 적혀 있다(workspace-state.ts).
  const [situation, setSituation] = useState("");
  const [character, setCharacter] = useState("");
  const [goal, setGoal] = useState("");
  const [blockageFlow, setBlockageFlow] = useState<BlockageFlowState>(
    initialBlockageFlowState,
  );
  // 이 셋을 보는 자리가 셋이다 — 건너뛰기를 열지 말지, 세션 생성 요청에 실을 값,
  // 그리고 건너뛴 연습으로 셀지. 한 벌로 묶어 그 셋이 같은 답을 보게 한다.
  const sceneDraft = useMemo<SceneContextDraft>(
    () => ({ situation, characterContext: character, goal }),
    [situation, character, goal],
  );

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
  /**
   * 대화의 낙관적 잠금 값. 답마다 실어 보내고 응답이 준 값으로 바꾼다 — 다른 곳에서 먼저
   * 저장됐으면 409 conversation_conflict 이고, 그때는 대화를 다시 읽어 이 값을 맞춘다.
   */
  const revisionRef = useRef(0);
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

  // 화면이 로컬 원본을 놓는 순간 그 blob 주소도 놓아 준다. 보관함 영상의 재생 주소는
  // 서버가 준 것이라 놓을 것이 없다 — blob 주소만 놓는다.
  const pickedUrl = pickedVideo(screen)?.url ?? null;
  useEffect(
    () => () => {
      if (pickedUrl?.startsWith("blob:")) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );

  // 마무리 전 영상이 떠 있는 동안 탭을 닫으려 하면 경고한다(practice.record). 웹에는 앱의
  // 업로드 큐가 없어 탭이 닫히면 올리던 것이 그대로 사라진다.
  const uploading = screen.kind === "uploading";
  useEffect(
    () => guardUnfinishedUpload(typeof window === "undefined" ? null : window, uploading),
    [uploading],
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
    (status: PracticeDetailView["status"], compressed: boolean) => {
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
    setBlockageFlow(initialBlockageFlowState);
    setHideConfirm(false);
    setDrawerOpen(false);
    replaceUrl("/practice/new");
  }, [clearWork, discardPendingUpload, reportProgress, setCurrentSession]);

  const resetToPrep = useCallback(() => resetTo(null), [resetTo]);

  // 끝난 회차의 노트에서 이어하기(practice.resume) — 같은 묶음의 다음 회차를 만든다. 같은 영상이면 준비
  // 화면이 그 영상을 보관함 영상으로 들고 서고(올릴 것이 없다), 새 영상이면 빈 준비 화면이다. 회차마다
  // 상황·인물·목표·막힘은 새로 확정하므로 미리 채우지 않는다.
  const continueFromCurrent = useCallback((reuseVideo: boolean) => {
    const id = currentSessionId();
    if (!id) return;
    const situationLabel = detail?.situation.trim();
    resetTo({
      id,
      // 자리표시자(".")로 채워진 장면은 이름이 못 된다.
      label: situationLabel && situationLabel.length > 1 ? situationLabel : null,
    });
    if (reuseVideo && detail && detail.video_id && !detail.video_purged) {
      dispatch({
        type: "videoPicked",
        video: { libraryId: detail.video_id, url: detail.playback_url || null, caption: SAME_VIDEO_CAPTION, durationMs: null },
      });
    }
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
      turn: ConversationTurnResponse,
      endedBy: "coach" | "actor_closing" = "coach",
    ) => {
      // 대화 id 는 회차와 1:1이라 바뀌지 않지만, revision 은 응답마다 오른다. 다음 답에 최신 값을 싣는다.
      coachIdRef.current = turn.conversation.id;
      revisionRef.current = turn.conversation.revision;
      const done = isConversationDone(turn);
      setMessages((m) => [...m, { role: "ai", text: turn.message }]);
      // 노트는 받아 두되 화면은 그대로 둔다 — 마지막 인사를 읽고 배우가 직접 넘어간다.
      dispatch({
        type: "coachTurnReceived",
        coachId: turn.conversation.id,
        done,
        report: turn.note ?? null,
      });
      if (done) {
        trackPracticeDialogueCompleted(
          dialogueTurnCountRef.current,
          reportTypeOf(turn.note),
          endedBy,
        );
      }
      if (turn.note) void refreshList();
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
        reportTypeOf(opened),
        dialogueTurnCountRef.current,
        "current",
      );
    }
  }, [countStepOnce, currentSessionId, screen]);

  /**
   * 대화 하나를 화면에 세운다. 새로 연 대화는 코치의 첫 말 하나가 전부이고, 이미 오간 대화를
   * 재개하거나 충돌 뒤 다시 읽은 것이면 지난 턴이 함께 온다.
   */
  const restoreCoach = useCallback((turn: ConversationTurnResponse, history?: Conversation | null) => {
    coachIdRef.current = turn.conversation.id;
    revisionRef.current = history?.revision ?? turn.conversation.revision;
    dialogueTurnCountRef.current = history ? actorTurnCount(history) : 0;
    setMessages(
      history ? conversationLines(history) : [{ role: "ai", text: turn.message }],
    );
    const done = isConversationDone(turn) || history?.status === "closed";
    // 첫 응답이 곧바로 complete 로 오는 경우가 있다. 그때도 화면은 그대로 두고 배우가
    // 정리보기를 누를 때 넘긴다.
    dispatch({
      type: "coachTurnReceived",
      coachId: turn.conversation.id,
      done,
      report: turn.note ?? null,
    });
    if (done) {
      trackPracticeDialogueCompleted(
        dialogueTurnCountRef.current,
        reportTypeOf(turn.note),
        "coach",
      );
    }
    if (turn.note) void refreshList();
  }, [refreshList]);

  /**
   * 회차마다 대화 시작에 쓰는 요청 id. 같은 회차에서 시작이 두 번 나가도(폴링이 끝난 직후와
   * 화면 복귀) 같은 id 라 대화는 하나다(coach_conversations.start_request_id).
   */
  const startRequestIdsRef = useRef(new Map<string, string>());
  const conversationRequestId = useCallback((practiceSessionId: string) => {
    const known = startRequestIdsRef.current.get(practiceSessionId);
    if (known) return known;
    const created = newRequestId();
    startRequestIdsRef.current.set(practiceSessionId, created);
    return created;
  }, []);

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
        const start = await startConversation(practiceSessionId, {
          requestId: conversationRequestId(practiceSessionId),
        });
        if (!isCurrentSession(practiceSessionId)) return;
        // 열린 대화를 재개한 것이면(revision 이 올라 있다) 지난 턴을 읽어 화면을 채운다.
        const history = needsTurnHistory(start) ? await getConversation(start.conversation.id) : null;
        if (!isCurrentSession(practiceSessionId)) return;
        restoreCoach(start, history);
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
  }, [conversationRequestId, countStepOnce, isCurrentSession, restoreCoach]);

  const startConversationAfterAnalysis = useCallback((practiceSessionId: string) => {
    void coordinatorFor(practiceSessionId).update("analyzed").catch(() => {});
  }, [coordinatorFor]);

  const trackAnalysis = useCallback((practiceSessionId: string) => {
    analysisControllerRef.current?.abort();
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    // 이 폴링이 얼마나 걸렸는지만 재는 시계다. 막대가 쓰는 경과 시간은 훅이 따로 잰다.
    const startedAt = Date.now();
    // 웹은 10초 간격이다(practice.analyze). 화면을 떠나면 조회만 멈추고 작업은 계속 돈다.
    void pollPracticeUntilSettled(practiceSessionId, {
      signal: controller.signal,
      onStatus: (status) => {
        if (!isCurrentSession(practiceSessionId)) return;
        dispatch({ type: "analysisStatusReported", status: sessionStatusOf(status) });
      },
    }).then(
      (practice) => {
        if (!isCurrentSession(practiceSessionId) || controller.signal.aborted) return;
        const settled = practiceToSessionDetail(practice);
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

  // "그만두기"는 명시적 취소다 — failed/cancelled 로 종결하고 늦은 완료가 붙지 않는다. 화면 이탈은 취소가 아니다.
  const cancelAnalysis = async () => {
    if (!activeId || cancelling) return;
    const sessionId = activeId;
    setCancelling(true);
    setError(null);
    try {
      await cancelPractice(sessionId);
      if (!isCurrentSession(sessionId)) return;
      analysisControllerRef.current?.abort();
      dispatch({ type: "analysisStatusReported", status: "failed" });
      reportProgress({ type: "settle", status: "failed" });
      void refreshList();
    } catch (cause) {
      if (isCurrentSession(sessionId)) setError(errorMessage(cause, "분석을 그만두지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      setCancelling(false);
    }
  };

  const [analysisRetrying, setAnalysisRetrying] = useState(false);
  const analysisRetryRef = useRef(false);
  const retryAnalysis = async () => {
    if (!activeId || analysisRetryRef.current) return;
    const sessionId = activeId;
    analysisRetryRef.current = true;
    setAnalysisRetrying(true);
    setError(null);
    try {
      await reanalyzeSession(sessionId);
      // 다시 분석한 회차는 대화도 새로 시작한다 — 시작 요청 id 를 버려 다음 시작이 새 요청이 되게 한다.
      startRequestIdsRef.current.delete(sessionId);
      if (!isCurrentSession(sessionId)) return;
      coachCoordinatorRef.current = null;
      reportProgress({ type: "reset" });
      reportProgress({ type: "duration", videoDurationMs });
      reportProgress({ type: "analyze", compressed: false });
      dispatch({ type: "analysisStatusReported", status: "analyzing" });
      trackAnalysis(sessionId);
    } catch {
      if (isCurrentSession(sessionId)) {
        setError("영상 분석을 다시 요청하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      analysisRetryRef.current = false;
      setAnalysisRetrying(false);
    }
  };

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
    const pending = startVideoUpload(file, {
      onProgress: reportProgress,
      onProfile: trackPracticeUploadProfiled,
    });
    uploadControllerRef.current = pending.controller;
    pendingUploadRef.current = pending;
    return pending;
  }, [reportProgress]);

  /** 보관함 영상은 올릴 것이 없다 — 곧바로 회차를 만들 수 있게 같은 모양의 약속을 만든다. */
  const startLibraryVideo = useCallback((video: LibraryVideo): PendingVideoUpload<PendingUploadResult> => {
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    const pending = {
      file: new File([], video.caption),
      controller,
      promise: Promise.resolve({ videoId: video.libraryId, durationMs: video.durationMs ?? 0, compressionRan: false }),
    };
    uploadControllerRef.current = controller;
    pendingUploadRef.current = pending;
    return pending;
  }, []);

  const begin = useCallback(async () => {
    if (screen.kind !== "prep" || !screen.video) return;
    const { video, continueFrom } = screen;
    const blockage = completeBlockageFlowWithDefault(blockageFlow);
    if (sceneContextTooLong(sceneDraft)) {
      setError(`상황·인물·목표는 각 ${SCENE_FIELD_MAX}자까지 적을 수 있어요.`);
      return;
    }
    if (isSceneContextBlank(sceneDraft)) trackPracticeSceneSkipped();
    if (blockageFlow.kind) {
      trackPracticeBlockageSubmitted(
        blockage.blockage_kind,
        blockage.sub_branch,
        blockage.blockage_detail,
      );
    }
    setError(null);
    // 누른 뒤에야 올린다(보관함 저장까지). 준비 화면 하나에서 선택을 모두 끝내므로 선행 창이 없다.
    // 이미 보관함에 있는 영상(같은 영상으로 이어하기·보관함에서 보내기)은 올릴 것이 없다.
    const { controller, promise } = isLocalVideo(video)
      ? uploadForCurrentFile(
          pendingUploadRef.current,
          video.file,
          startUpload,
        )
      : startLibraryVideo(video);
    dispatch({ type: "uploadStarted" });
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
    // 같은 본문에는 같은 요청 id — 실패 뒤 다시 눌러도 회차가 하나다.
    const requestKey = JSON.stringify([isLocalVideo(video) ? [video.file.name, video.file.size] : video.libraryId, sceneDraft, blockage, continueFrom?.id ?? null]);
    if (startRequestRef.current?.key !== requestKey) startRequestRef.current = { key: requestKey, id: newRequestId() };
    const started = await startPractice({
      upload: promise,
      signal: controller.signal,
      scene: sceneDraft,
      blockage,
      continueFromId: continueFrom?.id,
      reuseVideo: continueFrom !== null && !isLocalVideo(video),
      requestId: startRequestRef.current.id,
    });
    // 실패 처리를 아래 try 안에 두면, 이 처리 자신이 터졌을 때 catch 가 같은 실패를
    // 한 번 더 센다 — 옛 코드에서는 실패 처리가 catch 안에 있어 그럴 수 없었다.
    if (!started.ok) {
      try {
        reportFailure(started);
        // 묶음에 진행 중 회차가 있다 — 새 회차 대신 그 회차로 돌아간다(practice.resume).
        if (started.inProgress) void returnToInProgressRef.current(continueFrom?.id);
      } finally {
        // 영상은 이미 보관함에 확정됐으면 남겨 둔다 — 다시 누르면 올리지 않고 회차만 다시 만든다.
        if (started.videoId) {
          if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
        } else {
          releaseUpload();
        }
      }
      return;
    }
    try {
      const { practice, durationMs, compressionRan } = started;
      recordGuestAnalysis();
      setGuestUsed(guestAnalysisUsed());
      setCurrentSession(practice.id);
      coachCoordinatorRef.current = null;
      practiceAnalyticsContextRef.current = {
        kind: blockage.blockage_kind,
        subBranch: blockage.sub_branch,
        withEvidence: false,
      };
      const loaded = practiceToSessionDetail(practice);
      setDetail(loaded);
      reportProgress({ type: "duration", videoDurationMs: durationMs || null });
      enterAnalysis(loaded.status, compressionRan);
      dispatch({ type: "sessionCreated", status: loaded.status });
      setSending(false);
      urlLoadedRef.current = practice.id;
      replaceUrl(`/practice/new?session=${encodeURIComponent(practice.id)}`);
      // 업로드가 끝난 시점이 아니라 회차까지 만들어진 시점에 센다.
      // 업로드만 되고 회차 생성이 실패하면 연습이 시작된 게 아니다.
      trackVideoUploaded(durationMs);
      trackPracticeSessionCreated(
        durationMs,
        blockage.blockage_kind,
        blockage.sub_branch,
        isSceneContextBlank(sceneDraft),
      );
      trackAnalysis(practice.id);
      void refreshList();
    } catch (err) {
      // 시작 자체의 실패는 결과로 오므로, 여기 닿는 것은 회차를 받아 화면을 갈아
      // 끼우는 도중의 예외뿐이다. 옛 코드가 그것을 회차 생성 실패와 한 자리에
      // 세고 있었고, 그대로 둔다.
      reportFailure(describeStartFailure("session_create", err));
    } finally {
      releaseUpload();
    }
  }, [
    screen,
    blockageFlow,
    sceneDraft,
    enterAnalysis,
    setCurrentSession,
    refreshList,
    reportProgress,
    startUpload,
    startLibraryVideo,
    trackAnalysis,
  ]);

  const replyPendingRef = useRef(false);
  /**
   * 답 하나에 요청 id 하나. 같은 대화·같은 차례·같은 본문이면 같은 id 를 다시 쓴다 — 네트워크가
   * 끊겨 다시 보내도 메시지가 둘이 되지 않는다. 본문이 달라지면 새 id 라 422 지문 불일치를 만들지 않는다.
   */
  const replyRequestIdsRef = useRef(new Map<string, string>());
  const replyRequestIdFor = useCallback((conversationId: string, turnIndex: number, text: string) => {
    const key = `${conversationId}:${turnIndex}:${text}`;
    const known = replyRequestIdsRef.current.get(key);
    if (known) return known;
    const created = newRequestId();
    replyRequestIdsRef.current.set(key, created);
    return created;
  }, []);
  const send = useCallback(async (reply?: string) => {
    const text = (reply ?? answer).trim();
    const practiceId = currentSessionId();
    const coachId = coachIdRef.current;
    if (!text || sending || replyPendingRef.current || !coachId || !practiceId || screen.kind !== "chat") return;
    replyPendingRef.current = true;
    setError(null);
    const turnIndex = dialogueTurnCountRef.current + 1;
    setMessages((m) => [...m, { role: "me", text }]);
    setAnswer("");
    setSending(true);
    trackPracticeDialogueTurnSent(turnIndex, text);
    // 같은 답의 재전송은 같은 요청 id 다 — 지문이 같아 서버가 먼저 만든 코치 응답을 그대로 준다.
    const requestId = replyRequestIdFor(coachId, turnIndex, text);
    try {
      const turn = await replyConversation(
        { conversationId: coachId, text, revision: revisionRef.current },
        { requestId },
      );
      if (!isCurrentSession(practiceId) || coachIdRef.current !== coachId) return;
      dialogueTurnCountRef.current = turnIndex;
      pushAi(turn, isActorClosing(text) ? "actor_closing" : "coach");
    } catch (reason) {
      if (!isCurrentSession(practiceId) || coachIdRef.current !== coachId) return;
      trackPracticeDialogueTurnFailed(turnIndex);
      setMessages((m) => m.at(-1)?.role === "me" && m.at(-1)?.text === text ? m.slice(0, -1) : m);
      if (isClosedCoach(reason)) {
        await recoverClosedCoach({
          isCurrent: () => isCurrentSession(practiceId),
          close: () => {
            coachIdRef.current = null;
            dispatch({ type: "coachTurnReceived", coachId, done: true, report: null });
            setError(conversationErrorMessage(reason));
          },
          load: async () => ({ report: await getPracticeNote(practiceId) }),
          restore: (report) => {
            dispatch({ type: "coachTurnReceived", coachId, done: true, report });
          },
          unavailable: () => setError("대화는 마쳤지만 노트를 불러오지 못했어요. 지난 연습에서 다시 열어 주세요."),
        });
      } else if (isConversationConflict(reason)) {
        // 다른 곳에서 먼저 저장됐다. 쓴 답은 그대로 돌려주고 최신 대화를 읽어 revision 을 맞춘다 —
        // 그러면 배우는 같은 답을 다시 보내기만 하면 된다.
        setAnswer(text);
        setError(conversationErrorMessage(reason));
        try {
          const latest = await getConversation(coachId);
          if (!isCurrentSession(practiceId) || coachIdRef.current !== coachId) return;
          revisionRef.current = latest.revision;
          dialogueTurnCountRef.current = actorTurnCount(latest);
          setMessages(conversationLines(latest));
          if (latest.status === "closed") {
            dispatch({ type: "coachTurnReceived", coachId, done: true, report: null });
          }
        } catch {
          // 다시 읽지 못했다. 답은 화면에 남아 있고 다시 보내면 그때 최신 값을 받는다.
        }
      } else {
        setAnswer(text);
        setError(coachReplyError(reason));
      }
    } finally {
      replyPendingRef.current = false;
      setSending(false);
    }
  }, [answer, sending, pushAi, replyRequestIdFor, screen.kind, currentSessionId, isCurrentSession]);

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
      // 열린 대화면 서버가 같은 대화를 그대로 돌려준다. 닫힌 대화는 다시 열 수 없어
      // 409 conversation_closed 가 오고, 그 문구가 새 회차로 가라고 말한다(practice.resume).
      const start = await startConversation(practiceSessionId, {
        requestId: newRequestId(),
      });
      if (!isCurrentSession(practiceSessionId)) return;
      const history = needsTurnHistory(start) ? await getConversation(start.conversation.id) : null;
      if (!isCurrentSession(practiceSessionId)) return;
      restoreCoach(start, history);
    } catch (reason) {
      trackPracticeDialogueStartFailed(true);
      if (isCurrentSession(practiceSessionId)) {
        setError(conversationErrorMessage(reason, "대화를 다시 시작하지 못했어요. 잠시 후 다시 시도해 주세요."));
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
  const showLoadedSession = useCallback((loaded: PracticeDetailView) => {
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
        case "conversation":
          restoreCoach({ conversation: result.conversation, message: "", note: null }, result.conversation);
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
    [countStepOnce, startConversationAfterAnalysis, trackAnalysis, restoreCoach],
  );

  const openSession = useCallback(async (id: string) => {
    const selected = groupOfPractice(groups, id)?.practices.find((practice) => practice.id === id);
    if (selected) {
      trackPracticeHistoryOpened(
        selected.stage === "analyzing" ? "analyzing" : "analyzed",
        Boolean(selected.note_id),
        (Date.now() - Date.parse(selected.created_at)) / 86_400_000,
      );
    }
    setHideConfirm(false);
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
    groups,
    isCurrentSession,
    reportProgress,
    setCurrentSession,
    showLoadedSession,
    startWork,
  ]);

  // 409 practice_in_progress — 묶음 조회에서 진행 중 회차 id 를 얻어 거기로 돌아간다.
  useEffect(() => {
    returnToInProgressRef.current = async (rootId?: string) => {
      try {
        const { groups: latest } = await listPracticeGroups();
        setGroups(latest);
        const id = inProgressPracticeId(latest, rootId) ?? inProgressPracticeId(latest);
        if (id) await openSession(id);
      } catch {
        // 문구는 이미 떴다. 목록에서 직접 열 수 있다.
      }
    };
  }, [openSession]);

  // 보관함에서 "질문 코칭으로 보내기"(?video=) — 준비 화면이 그 영상을 들고 선다. 올릴 것이 없다.
  const videoParam = searchParams.get("video");
  const videoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!videoParam || videoLoadedRef.current === videoParam) return;
    videoLoadedRef.current = videoParam;
    let cancelled = false;
    void getVideo(videoParam).then(
      (video) => {
        if (cancelled || video.purged_at) return;
        dispatch({
          type: "videoPicked",
          video: { libraryId: video.id, url: video.playback_url ?? null, caption: LIBRARY_VIDEO_CAPTION, durationMs: video.duration_ms },
        });
        reportProgress({ type: "duration", videoDurationMs: video.duration_ms });
      },
      () => {
        if (!cancelled) setError("보관함 영상을 불러오지 못했어요.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [videoParam, reportProgress]);

  // 주소에 ?session= 이 실려 오면(연습 기록 링크·새로고침) 그 세션을 연다.
  // 클릭으로 여는 경로는 openSession 이고, 이쪽은 첫 진입만 맡는다.
  useEffect(() => {
    if (!sessionParam || urlLoadedRef.current === sessionParam) return;
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
    sessionParam,
    applyLoadOutcome,
    reportProgress,
    sessionIsCurrentOrFree,
    setCurrentSession,
    showLoadedSession,
  ]);

  const removeSession = useCallback(async () => {
    const removing = activeId;
    if (!removing) return;
    const doneDeleting = startWork("deleting", removing);
    try {
      const outcome = await removePractice({
        sessionId: removing,
        rootId: detail?.root_id,
        isCurrent: () => isCurrentSession(removing),
      });
      switch (outcome.kind) {
        case "removed":
          resetToPrep();
          void refreshList();
          return;
        // 목록에서는 사라져야 하지만 화면은 그새 연 다른 연습의 것이다.
        case "removedSuperseded":
          void refreshList();
          return;
        case "failed":
          setError("연습을 숨기지 못했어요. 잠시 후 다시 시도해 주세요.");
          return;
        // 못 지운 것도 남의 화면에는 띄우지 않는다.
        case "failedSuperseded":
          return;
        default: {
          const unhandled: never = outcome;
          return unhandled;
        }
      }
    } finally {
      // 되돌아간 길은 resetToPrep 이 이미 놓고 갔다. 그때는 켠 것이 남아 있지 않아
      // 이 끝맺음이 아무 일도 하지 않는다.
      doneDeleting();
    }
  }, [activeId, detail, isCurrentSession, resetToPrep, refreshList, startWork]);

  const activeGroup = activeId ? groupOfPractice(groups, activeId) : null;
  const noteGroupTitle = activeGroup ? groupTitle(activeGroup) : detail?.situation ?? "";

  const noteBySession = useMemo(
    () => new Set(groups.flatMap((g) => g.practices.filter((p) => p.note_id).map((p) => p.id))),
    [groups],
  );
  // 게스트가 끝나면(서버가 갱신을 거절) 그 게스트의 목록은 더 이상 열 수 없다. 받아 둔
  // 목록을 지우는 대신 여기서 가린다 — 이펙트에서 동기 setState 를 하지 않기 위해서다.
  // 목록은 묶음·회차다(practice.library). 숨긴 묶음은 빠진다.
  // 최근 30일 필터는 켤 때의 시각을 들고 있는다 — 렌더마다 새로 읽으면 같은 목록이 이유 없이 흔들린다.
  const { running, finished } = useMemo(
    () => railGroups(hasSession ? (recentOnly ? recent30(groups, recentOnly) : groups) : []),
    [hasSession, groups, recentOnly],
  );
  const toggleRail = useCallback(() => setRailOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const reselectVideo = useCallback(() => fileInputRef.current?.click(), []);

  const questionCount = messages.filter((message) => message.role === "ai").length;
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
      recentOnly={recentOnly !== null}
      onToggleRecent={() => setRecentOnly((on) => (on ? null : new Date()))}
      listError={hasSession && listError}
      canTransfer={hasSession}
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
              recentOnly={recentOnly !== null}
              onToggleRecent={() => setRecentOnly((on) => (on ? null : new Date()))}
              listError={hasSession && listError}
              canTransfer={hasSession}
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
                  onClick={() => setHideConfirm((v) => !v)}
                  className="hidden h-8 rounded-[10px] border border-[#e5e8eb] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#f2f4f6] disabled:text-[#c9d3df] sm:block"
                >
                  숨기기
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
                href="/library"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                보관함
              </Link>
              <Link
                href="/reading"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                리딩
              </Link>
              <Link
                href="/admissions"
                className="flex h-8 items-center rounded-[10px] px-2 text-xs font-black text-[#8b95a1] transition hover:bg-[#f2f4f6] hover:text-[#4e5968]"
              >
                입시
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
          {/* 숨김 확인. 오류 배너와 화면 분기 사이에는 아무것도 끼우지 않는다(workspace-note-handoff 테스트). */}
          {hideConfirm && activeId ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-[#edf0f3] bg-[#fff8ec] px-4 py-3 sm:px-5">
              <p className="text-sm font-bold text-[#8a4b00]">{HIDE_GROUP_COPY}</p>
              <button
                type="button"
                disabled={busyDisabled.remove}
                onClick={() => {
                  setHideConfirm(false);
                  void removeSession();
                }}
                className="h-8 rounded-[10px] bg-[#8a4b00] px-3 text-xs font-black text-white disabled:opacity-40"
              >
                숨기기
              </button>
              <button type="button" onClick={() => setHideConfirm(false)} className="h-8 rounded-[10px] px-3 text-xs font-black text-[#4e5968]">
                취소
              </button>
            </div>
          ) : null}
        </header>

        <WorkspaceErrorBanner error={error} />

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
                groupTitle={noteGroupTitle}
                messages={messages}
                backDisabled={busyDisabled.backToChat}
                onBackToChat={
                  body.backTo === "restart"
                    ? restartAfterBlocked
                    : () => dispatch({ type: "chatReopened" })
                }
                onFinish={openReview}
                onContinueSame={() => continueFromCurrent(true)}
                onContinueNew={() => continueFromCurrent(false)}
                canReuseVideo={detail !== null && !detail.video_purged}
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
                scrollRef={chatScrollRef}
                onSend={(reply) => void send(reply)}
                done={body.done}
                noteReady={body.noteReady}
                onOpenNote={openNote}
              />
            )}
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
              {body.footer.kind === "start" ? (
                <>
                  <p className="rounded-xl bg-[#f4f6fa] px-3.5 py-2.5 text-xs font-semibold leading-4 text-[#4e6183]">
                    {guestAnalysisNotice(guestUsed)}
                  </p>
                  <StartRow
                    ready={body.footer.ready}
                    onStart={() => void begin()}
                  />
                  <div className="grid gap-8 sm:gap-9">
                    <div className="flex items-center gap-2 rounded-xl bg-[#f4f6fa] px-3.5 py-2.5">
                      <span aria-hidden="true" className="text-sm leading-none text-[#3182f6]">✦</span>
                      <p className="text-xs font-semibold leading-4 text-[#4e6183]">
                        막히는 지점을 더 잘 찾기 위해 장면 정보를 간단히 물어볼게요.
                      </p>
                    </div>
                    <SceneForm
                      situation={visibleScene.situation}
                      character={visibleScene.character}
                      goal={visibleScene.goal}
                      onSituation={setSituation}
                      onCharacter={setCharacter}
                      onGoal={setGoal}
                    />
                    <BlockageFields state={blockageFlow} onChange={setBlockageFlow} />
                  </div>
                </>
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
                  retrying={analysisRetrying}
                  onRetry={() => void retryAnalysis()}
                  cancelling={cancelling}
                  onCancel={() => void cancelAnalysis()}
                />
              )}
              <IntroLine />
            </div>
          </div>
        )}
      </div>

      {reviewTrigger ? (
        <ExitReviewModal
          trigger={reviewTrigger}
          screen={feedbackScreen(view.review.kind)}
          practiceId={activeId}
          onClose={onReviewClose}
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
  recentOnly,
  onToggleRecent,
  listError,
  canTransfer,
}: {
  open: boolean;
  drawer?: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  running: RailGroup[];
  finished: RailGroup[];
  activeId: string | null;
  hasNote: Set<string>;
  /** 지난 연습을 최근 30일로 좁혀 보는 중인가(practice.library) */
  recentOnly: boolean;
  onToggleRecent: () => void;
  listError: boolean;
  /** 옮길 자료가 있는가. 게스트가 있을 때만 이관 코드 화면으로 가는 길을 연다. */
  canTransfer: boolean;
}) {
  const width = drawer ? "w-[300px]" : open ? "w-[280px]" : "w-16";
  // 목록은 서버가 준 묶음(root_id)과 회차(ordinal)다(practice.library). 묶음은 가장 최근 회차 기준으로
  // 정렬돼 온다 — 어제 이어한 묶음이 목록 바닥에 있으면 못 찾는다.
  // 묶음은 기본으로 접는다 — 회차가 쌓일수록 목록이 길어져 다른 연습이 밀려난다.
  // 지금 열려 있는 회차가 속한 묶음은 항상 펼친다: 접혀 있으면 내가 어디 있는지 안 보인다.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (rootId: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  /** 묶음 줄이 가리키는 회차 — 진행 중이면 그 회차, 아니면 마지막 회차 */
  const headOf = (g: RailGroup) =>
    g.inProgressPracticeId ?? g.practices[g.practices.length - 1]?.id ?? g.rootId;
  const isActiveGroup = (g: RailGroup) => g.practices.some((p) => p.id === activeId);
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
            <RailSection label="진행 중">
              {running.map((g) => (
                <RailItem
                  key={g.rootId}
                  title={g.title}
                  meta={`${g.practices.length > 1 ? `${g.practices.length}차 · ` : ""}같이 볼 장면을 찾고 있어요 · ${whenLabel(g.newestAt)}`}
                  active={isActiveGroup(g)}
                  dot
                  onClick={() => onOpen(headOf(g))}
                />
              ))}
            </RailSection>
          ) : null}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <p className="text-[11.5px] font-black text-[#8b95a1]">지난 연습</p>
              {/* 최근 30일과 전체를 오간다. 회차 시작 날짜(한국 시간) 기준이다. */}
              <button
                type="button"
                aria-pressed={recentOnly}
                onClick={onToggleRecent}
                className={`h-6 rounded-full px-2.5 text-[11px] font-black transition ${
                  recentOnly ? "bg-[#e8f3ff] text-[#3182f6]" : "bg-[#f2f4f6] text-[#8b95a1] hover:bg-[#eef2f6]"
                }`}
              >
                {recentOnly ? RECENT_FILTER_LABEL : ALL_FILTER_LABEL}
              </button>
            </div>
            {finished.length === 0 ? (
              <p className="px-2 py-3 text-xs font-semibold leading-5 text-[#8b95a1]">
                {recentOnly ? "최근 30일에 한 연습이 없어요." : "첫 영상을 올리면 여기에 쌓여요."}
              </p>
            ) : (
              // 달마다 나눈다 — 회차가 쌓이면 어느 시기의 연습인지가 목록에서 바로 보여야 한다.
              byMonth(finished).map((section) => (
                <RailSection key={section.label} label={section.label}>
                  {section.groups.map((g) => {
                const single = g.practices.length <= 1;
                const head = g.practices[g.practices.length - 1];
                const opened = !single && (openGroups.has(g.rootId) || isActiveGroup(g));
                return (
                  <div key={g.rootId}>
                    <RailItem
                      title={`${g.favorite ? "★ " : ""}${g.title}`}
                      meta={`${whenLabel(g.newestAt)}${
                        single ? (head && hasNote.has(head.id) ? " · 문장 남김" : "") : ` · 회차 ${g.practices.length}개`
                      }`}
                      active={single ? isActiveGroup(g) : false}
                      onClick={() => (single ? onOpen(headOf(g)) : toggleGroup(g.rootId))}
                    />
                    {single ? null : (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.rootId)}
                          className="ml-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-black text-[#8b95a1] transition hover:bg-[#eef2f6] hover:text-[#4e5968]"
                        >
                          <span
                            aria-hidden="true"
                            className={`inline-block transition-transform ${opened ? "rotate-90" : ""}`}
                          >
                            ▸
                          </span>
                          {opened ? "회차 접기" : `회차 ${g.practices.length}개 펼치기`}
                        </button>
                        {opened
                          ? g.practices.map((practice) => (
                              <div
                                key={practice.id}
                                className="ml-4 border-l-2 border-[#e5e8eb] pl-1.5"
                              >
                                <RailItem
                                  title={practice.title}
                                  meta={`${practice.ordinal}차 · ${whenLabel(practice.createdAt)}${
                                    hasNote.has(practice.id) ? " · 문장 남김" : ""
                                  }`}
                                  active={practice.id === activeId}
                                  onClick={() => onOpen(practice.id)}
                                />
                              </div>
                            ))
                          : null}
                      </>
                    )}
                  </div>
                );
                  })}
                </RailSection>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-1 flex-col items-center gap-2 overflow-y-auto">
          {[...running, ...finished].slice(0, 8).map((g) => (
            <button
              key={g.rootId}
              type="button"
              onClick={() => onOpen(headOf(g))}
              // 장면을 건너뛴 연습은 아바타 글자가 다 같은 "연"이 된다. 펼친 목록과
              // 같은 제목을 써야 접어 둔 채로도 서로를 구분할 수 있다.
              title={g.title}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-black transition ${
                isActiveGroup(g)
                  ? "bg-[#e8f3ff] text-[#3182f6]"
                  : "bg-[#f2f4f6] text-[#8b95a1] hover:bg-[#eef2f6]"
              }`}
            >
              {(g.title === UNTITLED_PRACTICE ? "연" : g.title)[0]}
            </button>
          ))}
        </div>
      )}

      {/* 입시로 나가는 길은 위 헤더 오른쪽 끝이 맡는다. 여기 두면 두 군데가 된다.
          앱 다운로드만 예외로 드로어에 둔다 — 폰에서 연습이 열려 있으면 헤더 오른쪽 줄이
          통째로 숨어서(375px에 제목 자리가 안 남는다) 앱으로 가는 길이 사라진다.
          데스크톱 레일에는 넣지 않는다. 헤더가 이미 보이는 자리라 두 군데가 된다. */}
      {drawer ? (
        <Link
          href="/library"
          className="mt-auto flex items-center gap-3 border-t border-[#edf0f3] px-4 py-3 text-[13px] font-black text-[#191f28] transition hover:bg-[#eef2f6]"
        >
          영상 보관함
        </Link>
      ) : null}
      {drawer ? (
        <Link
          href="/app"
          className="flex items-center gap-3 border-t border-[#edf0f3] px-4 py-3.5 transition hover:bg-[#eef2f6]"
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

      {/* 계정 자리는 없다 — 웹에는 로그인이 없다. 대신 게스트의 자료가 이 브라우저에만
          매여 있다는 것을 목록 아래에서 알린다(게스트 시작 안내). 접힌 레일에는 글을 둘
          폭이 없어 펼쳤을 때만 보인다. */}
      {open ? (
        <div
          className={`border-t border-[#edf0f3] px-4 py-3.5 ${drawer ? "" : "mt-auto"}`}
        >
          <p className="text-[11.5px] font-semibold leading-[17px] text-[#8b95a1]">
            {GUEST_BROWSER_ONLY_NOTICE}
          </p>
          {canTransfer ? (
            <Link
              href="/transfer"
              className="mt-1.5 inline-block text-[12.5px] font-black text-[#3182f6] transition hover:text-[#1b64da]"
            >
              앱으로 옮기기
            </Link>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
});

function RailSection({ label, children }: { label: string; children: React.ReactNode }) {
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

function Stepper({ current }: { current: 1 | 2 }) {
  const steps: [string, string][] = [
    ["1", "영상 올리기"],
    ["2", "질문 받기"],
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
      className="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-[16px] border border-[#c9dcf8] bg-[#f8fbff] px-4 text-center transition hover:border-[#3182f6] hover:bg-[#e8f3ff] sm:h-[300px] sm:rounded-[20px]"
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
  onSituation,
  onCharacter,
  onGoal,
}: {
  situation: string;
  character: string;
  goal: string;
  onSituation: (v: string) => void;
  onCharacter: (v: string) => void;
  onGoal: (v: string) => void;
}) {
  return (
    <section>
      <h2 className="text-[15px] font-black leading-tight tracking-[-0.01em] text-[#191f28] sm:text-base">
        이 장면에서 무엇을 연기했는지 알려 주세요
      </h2>
      <p className="mt-1 text-xs font-semibold leading-[18px] text-[#6b7684]">
        정확히 쓰지 않아도 괜찮아요. 작성한 내용은 질문을 만드는 데만 사용해요.
      </p>
      <div className="mt-3.5 grid gap-3.5">
        <SceneField label="상황" value={situation} onChange={onSituation} placeholder="이별을 통보받은 직후, 카페에서" />
        <SceneField label="인물" value={character} onChange={onCharacter} placeholder="담담한 척하는 20대 후반 여성" />
        <SceneField label="목표" value={goal} onChange={onGoal} placeholder="상대가 마음을 돌려 다시 앉게 만들기" />
      </div>
    </section>
  );
});

function SceneField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-black text-[#333d4b]">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        maxLength={SCENE_FIELD_MAX}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#e5e8eb] bg-[#f8fafc] px-3.5 text-sm font-semibold text-[#191f28] outline-none transition placeholder:text-[13px] placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:bg-white focus:ring-4 focus:ring-[#e8f3ff]"
      />
    </label>
  );
}

function StartRow({
  ready,
  onStart,
}: {
  ready: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
      <div className="flex w-full gap-2 sm:w-auto">
        <button
          type="button"
          disabled={!ready}
          onClick={onStart}
          className="h-12 w-full rounded-[14px] bg-[#3182f6] px-6 text-[15px] font-black text-white shadow-[0_10px_24px_rgba(49,130,246,0.24)] transition hover:bg-[#1b64da] disabled:bg-[#c9d3df] disabled:shadow-none sm:w-auto"
        >
          질문 받기
        </button>
      </div>
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
  retrying = false,
  onRetry,
  cancelling = false,
  onCancel,
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
  retrying?: boolean;
  onRetry?: () => void;
  cancelling?: boolean;
  /** 그만두기 — 명시적 취소. 화면을 떠나는 것과 다르다(practice.analyze). */
  onCancel?: () => void;
}) {
  if (failed) {
    return (
      <div aria-live="polite" className="rounded-[28px] bg-white p-5 shadow-[0_16px_48px_rgba(25,31,40,0.08)] sm:p-6">
        <h2 className="text-lg font-black leading-7 text-[#191f28]">
          영상 분석을 완료하지 못했어요
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4e5968]">
          영상을 분석해야 대화를 시작할 수 있어요. 다시 분석해 주세요.
        </p>
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="mt-5 min-h-12 rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#3182f6] disabled:bg-[#b0d2ff]"
        >
          {retrying ? "분석 요청 중…" : "영상 다시 분석"}
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
      {phase === "scan" && onCancel ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#8b95a1]">
            화면을 떠나도 살펴보는 일은 계속돼요. 목록에서 다시 열 수 있어요.
          </span>
          <button
            type="button"
            disabled={cancelling}
            onClick={onCancel}
            className="h-8 rounded-[10px] border border-[#e5e8eb] px-3 text-xs font-black text-[#4e5968] transition hover:bg-[#f2f4f6] disabled:text-[#c9d3df]"
          >
            {cancelling ? "그만두는 중…" : "그만두기"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IntroLine() {
  return (
    <p className="text-center text-xs font-semibold leading-5 text-[#8b95a1]">
      <span aria-hidden="true">🔒</span> 업로드한 영상은 분석 후 안전하게 처리돼요{" "}
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
  detail: PracticeDetailView | null;
  open: boolean;
  onToggle: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const partialNotice = detail ? analysisNotice(detail.analysis_status) : null;
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
  const summary = detail?.summary;
  const observations = summary && "observations" in summary ? summary.observations : [];
  const recordRows = videoRecordRows(summary);
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
            {partialNotice ? (
              <p className="mt-4 rounded-xl bg-[#fff8ec] px-3 py-2 text-xs font-bold leading-5 text-[#8a4b00]">
                {partialNotice}
              </p>
            ) : null}
            <SceneRows rows={mobileRows} />
            <PreviousConversations conversations={detail?.previous_conversations ?? []} />
            {recordRows.length > 0 ? (
              <div className="mt-4">
                <p className="text-[13.5px] font-black">영상 기록</p>
                <SceneRows rows={recordRows} />
              </div>
            ) : null}
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
          {partialNotice ? (
            <p className="rounded-xl bg-[#fff8ec] px-3 py-2 text-xs font-bold leading-5 text-[#8a4b00]">
              {partialNotice}
            </p>
          ) : null}
          <div className="rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
            <p className="text-[13.5px] font-black">이 장면에서 연기한 것</p>
            <SceneRows rows={rows} />
            <PreviousConversations conversations={detail?.previous_conversations ?? []} />
          </div>
          {recordRows.length > 0 ? (
            <div className="rounded-[18px] bg-white p-4 shadow-[0_12px_36px_rgba(25,31,40,0.05)]">
              <p className="text-[13.5px] font-black">영상 기록</p>
              <SceneRows rows={recordRows} />
            </div>
          ) : null}
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
              {noteReady ? "지금까지 이야기한 걸 정리해 뒀어요." : "아직 정리 없음 · 오늘 나눈 대화는 남아 있어요."}
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
          <CoachComposer
            answer={answer}
            setAnswer={setAnswer}
            sending={sending}
            inputEnabled={inputEnabled}
            onSend={() => onSend()}
          />
        )}
      </div>
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
  groupTitle,
  messages,
  backDisabled,
  onBackToChat,
  onFinish,
  onContinueSame,
  onContinueNew,
  canReuseVideo,
}: {
  report: PracticeReport;
  groupTitle: string;
  messages: ChatMsg[];
  /** 뒤에서 도는 일이 대화로 돌아가는 길을 막고 있는가. */
  backDisabled: boolean;
  onBackToChat: () => void;
  onFinish: () => void;
  /** 이어하기(practice.resume) — 같은 영상이면 올릴 것이 없고, 새 영상이면 준비 화면이 빈 채로 선다. */
  onContinueSame: () => void;
  onContinueNew: () => void;
  /** 영상이 파기됐으면 같은 영상으로는 이어갈 수 없다. */
  canReuseVideo: boolean;
}) {
  if (isBlockedReport(report)) {
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
        <PracticeReportCards report={report} groupTitle={groupTitle} />
      </div>

      <div className="grid gap-2.5 border-t border-[#edf0f3] p-3.5 sm:p-4">
        {/* 같은 묶음의 다음 회차 — 코치가 이 연습의 대화를 이어받는다 (SOMA-417). 영상은 같은 것이든 새 것이든
            회차마다 상황·인물·목표·막힘은 새로 확정한다. */}
        <div className="flex gap-2.5">
          {canReuseVideo ? (
            <button
              type="button"
              onClick={onContinueSame}
              className="h-12 flex-1 rounded-[14px] bg-[#e8f3ff] text-sm font-black text-[#1b64da] transition hover:bg-[#d8eaff]"
            >
              {CONTINUE_SAME_VIDEO_LABEL}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onContinueNew}
            className="h-12 flex-1 rounded-[14px] bg-[#e8f3ff] text-sm font-black text-[#1b64da] transition hover:bg-[#d8eaff]"
          >
            {CONTINUE_NEW_VIDEO_LABEL}
          </button>
        </div>
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

/**
 * 화면 어디서 난 오류든 이 하나가 그린다. 헤더 바로 아래, 어느 화면인지를 가르는
 * 분기보다 **앞**이라 무엇을 보고 있든 같은 자리에 뜬다.
 *
 * 옛 코드는 이것을 패널마다 따로 배선했고, 그 배선이 없는 화면(노트·막힘)에서는
 * 오류가 조용히 사라졌다 — 노트를 보다 목록에서 다른 연습을 열었는데 그 조회가
 * 실패하면 아무 말도 듣지 못했다.
 *
 * ⚠ 그 장면이 다 풀린 것은 아니다. 조회가 실패해도 화면은 **지난 연습의 노트를
 * 그대로 들고 있다** — workspace-state.ts 의 `sessionOpening` 이 노트만 계속 드는
 * 것은 조회가 성공했을 때 깜빡이지 않으려는 것이고, 실패했을 때 화면을 어디로
 * 보낼지는 아직 정해진 적이 없다(SOMA-409 에 남겼다). 이제 그 위에 오류가 뜨지만
 * 본문은 여전히 남의 노트다.
 */
function WorkspaceErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="shrink-0 border-b border-[#edf0f3] bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939] sm:px-5"
    >
      {error}
    </p>
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
