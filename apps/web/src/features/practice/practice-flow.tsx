"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthSession, type AuthSessionResponse } from "@/lib/api/auth";
import {
  createPracticeSession,
  createPracticeSummary,
  createPracticeTurn,
  createPracticeUploadIntent,
  finalizePracticeUploadIntent,
  listPracticeSessions,
  updatePracticeObservation,
} from "@/lib/api/sessions";
import {
  MAX_DIALOGUE_ANSWER_COUNT,
  MIN_DIALOGUE_ANSWER_COUNT,
} from "@/lib/practice/dialogue-completion-policy";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  CoachSessionDto,
  ConfirmationState,
  CreateSessionRequest,
  ObservationDto,
  SessionStatus,
  TurnDto,
} from "@/lib/api/types";

type Step =
  | "gate"
  | "home"
  | "history"
  | "video"
  | "context"
  | "upload"
  | "observe"
  | "dialogue"
  | "summary";

type SceneDraft = CreateSessionRequest;
type PracticeEntry = "home" | "new" | "history";

type DialogueEntry = Pick<TurnDto, "speaker" | "content" | "questionFocus"> & {
  id: string;
};

const excludedObservationState = ("rej" + "ected") as ConfirmationState;
const allowedUploadMimeTypes = new Set(["video/mp4", "video/quicktime"]);
const maxUploadBytes = 300 * 1024 * 1024;
const uploadSizeLimitLabel = "300MB";
const genreOptions = ["연극", "영화", "뮤지컬", "드라마", "기타"] as const;
const entryPath: Record<PracticeEntry, string> = {
  home: "/home",
  new: "/practice/new",
  history: "/practice/history",
};
const entryInitialStep: Record<PracticeEntry, Step> = {
  home: "home",
  new: "video",
  history: "history",
};
const emptySceneDraft: SceneDraft = {
  medium: "upload_url",
  genre: "",
  situation: "",
  characterContext: "",
  subtext: "",
  videoUrl: "",
  durationMs: undefined,
};
const practiceExample: SceneDraft = {
  ...emptySceneDraft,
  genre: "연극",
  situation: "시각장애인이 사랑하는 마음을 숨기는 상황",
  characterContext:
    "시각장애가 있는 인물이 오래 사랑해 온 상대와 단둘이 있다. 지금의 관계를 잃을까 두려워 자신의 마음을 숨기려 한다.",
  subtext: "좋아한다고 말하고 싶지만 지금의 관계도 잃고 싶지 않다.",
};

function validateUploadFile(file: File | null): asserts file is File {
  if (!file) {
    throw new Error("업로드할 영상 파일을 선택해 주세요.");
  }
  if (!allowedUploadMimeTypes.has(file.type)) {
    throw new Error("MP4 또는 MOV 파일만 업로드할 수 있어요.");
  }
  if (file.size <= 0 || file.size > maxUploadBytes) {
    throw new Error(`${uploadSizeLimitLabel} 이하의 영상 파일을 선택해 주세요.`);
  }
}

function toDialogueEntries(turns: TurnDto[]): DialogueEntry[] {
  return turns.map((turn) => ({
    id: turn.id,
    speaker: turn.speaker,
    content: turn.content,
    questionFocus: turn.questionFocus,
  }));
}

export function PracticeFlow({ entry = "new" }: { entry?: PracticeEntry }) {
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [step, setStep] = useState<Step>("gate");
  const [loadingMessage, setLoadingMessage] =
    useState("연습 공간을 준비하는 중이에요.");
  const [practiceSession, setPracticeSession] =
    useState<CoachSessionDto | null>(null);
  const [scene, setScene] = useState<SceneDraft>(emptySceneDraft);
  const [observation, setObservation] = useState<ObservationDto | null>(null);
  const [answer, setAnswer] = useState("");
  const [dialogue, setDialogue] = useState<DialogueEntry[]>([]);
  const [finalSentence, setFinalSentence] = useState("");
  const [finalReflectionPrompt, setFinalReflectionPrompt] = useState("");
  const [summarySaved, setSummarySaved] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const uploadPreviewUrlRef = useRef<string | null>(null);
  const [nextReflectionQuestion, setNextReflectionQuestion] = useState("");
  const [practiceHistory, setPracticeHistory] = useState<CoachSessionDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getAuthSession()
      .then((authSession) => {
        if (!mounted) return;
        if (!authSession.authenticated) {
          window.location.href = `/auth/login?next=${encodeURIComponent(entryPath[entry])}`;
          return;
        }
        if (!authSession.terms.accepted) {
          window.location.href = "/terms";
          return;
        }
        setSession(authSession);
        setStep(entryInitialStep[entry]);
        setHistoryLoading(true);
        listPracticeSessions()
          .then(({ sessions }) => {
            if (!mounted) return;
            setPracticeHistory(sessions);
            setHistoryError(null);
          })
          .catch((error: unknown) => {
            if (!mounted) return;
            setHistoryError(
              error instanceof Error
                ? error.message
                : "이전 기록을 불러오지 못했어요.",
            );
          })
          .finally(() => {
            if (!mounted) return;
            setHistoryLoading(false);
          });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setLoadingMessage(
          error instanceof Error
            ? error.message
            : "연습 공간을 준비하지 못했어요.",
        );
      });

    return () => {
      mounted = false;
    };
  }, [entry]);

  useEffect(
    () => () => {
      if (uploadPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadPreviewUrlRef.current);
      }
    },
    [],
  );

  const actorAnswers = useMemo(
    () => dialogue.filter((entry) => entry.speaker === "actor"),
    [dialogue],
  );

  function updateScene<K extends keyof SceneDraft>(
    key: K,
    value: SceneDraft[K],
  ) {
    setScene((current) => ({ ...current, [key]: value }));
  }

  function handleApiError(error: unknown) {
    setApiError(
      error instanceof Error ? error.message : "요청을 처리하지 못했어요.",
    );
  }

  function updateFinalSentence(value: string) {
    setFinalSentence(value);
    setSummarySaved(false);
  }

  function finishDialogue() {
    setApiError(null);
    setFinalReflectionPrompt(
      "지금까지 대화에서 발견한 인물의 마음을 마지막 한 문장으로 남겨 볼까요?",
    );
    setSummarySaved(false);
    setStep("summary");
  }

  function selectUploadFile(file: File | null) {
    try {
      validateUploadFile(file);
      const nextPreviewUrl = URL.createObjectURL(file);

      if (uploadPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadPreviewUrlRef.current);
      }

      uploadPreviewUrlRef.current = nextPreviewUrl;
      setUploadPreviewUrl(nextPreviewUrl);
      setUploadFile(file);
      setApiError(null);
      setStep("context");
    } catch (error) {
      if (uploadPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadPreviewUrlRef.current);
        uploadPreviewUrlRef.current = null;
      }
      setUploadPreviewUrl(null);
      setUploadFile(null);
      handleApiError(error);
      setStep("video");
    }
  }

  function returnToUploadSelection() {
    if (uploadPreviewUrlRef.current) {
      URL.revokeObjectURL(uploadPreviewUrlRef.current);
      uploadPreviewUrlRef.current = null;
    }
    setUploadPreviewUrl(null);
    setUploadFile(null);
    setApiError(null);
    setStep("video");
  }

  async function startUpload(selectedFile = uploadFile) {
    setSubmitting(true);
    setApiError(null);

    try {
      validateUploadFile(selectedFile);

      const genre = scene.genre?.trim();
      const situation = scene.situation?.trim();
      const characterContext = scene.characterContext?.trim();

      if (!genre || !situation || !characterContext) {
        throw new Error("장르, 상황, 인물 맥락을 먼저 입력해 주세요.");
      }

      setUploadFile(selectedFile);
      setStep("upload");

      let sessionDraft: CreateSessionRequest = {
        ...scene,
        genre,
        situation,
        characterContext,
        videoUrl: scene.videoUrl?.trim() || undefined,
        subtext: scene.subtext?.trim() || undefined,
      };

      if (scene.medium === "upload_url") {
        const { uploadIntent } = await createPracticeUploadIntent({
          fileMetadata: {
            fileName: selectedFile.name,
            mimeType: selectedFile.type as "video/mp4" | "video/quicktime",
            sizeBytes: selectedFile.size,
            durationMs: scene.durationMs,
          },
        });

        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          throw new Error("Supabase 브라우저 클라이언트 설정이 필요해요.");
        }

        const { error } = await supabase.storage
          .from(uploadIntent.storageBucket)
          .upload(uploadIntent.storagePath, selectedFile, {
            contentType: selectedFile.type,
            upsert: false,
          });

        if (error) {
          throw new Error(error.message);
        }

        const finalizedUpload = await finalizePracticeUploadIntent(
          uploadIntent.uploadIntentId,
          {
            storagePath: uploadIntent.storagePath,
            durationMs: scene.durationMs,
          },
        );
        sessionDraft = {
          ...sessionDraft,
          sessionId: uploadIntent.sessionId,
          uploadIntentId: uploadIntent.uploadIntentId,
          storagePath: finalizedUpload.storagePath,
          videoUrl: finalizedUpload.videoUrl,
          durationMs: finalizedUpload.durationMs ?? scene.durationMs,
        };
      }

      const result = await createPracticeSession(sessionDraft);
      setPracticeHistory((current) => [
        result.session,
        ...current.filter((item) => item.id !== result.session.id),
      ]);
      setPracticeSession(result.session);
      setObservation(result.session.observations[0] ?? null);
      setDialogue(toDialogueEntries(result.session.turns));
      setFinalSentence(result.session.finalActorSentence ?? "");
      setFinalReflectionPrompt("");
      setNextReflectionQuestion("");
      setSummarySaved(false);
      setStep(result.session.observations[0] ? "observe" : "dialogue");
    } catch (error) {
      handleApiError(error);
      setStep(selectedFile ? "context" : "video");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmObservation(confirmationState: ConfirmationState) {
    if (!practiceSession || !observation) return;

    setSubmitting(true);
    setApiError(null);
    setSummarySaved(false);

    try {
      const result = await updatePracticeObservation(
        practiceSession.id,
        observation.id,
        { confirmationState },
      );
      setPracticeSession(result.session);
      setObservation(result.observation);
      setDialogue(toDialogueEntries(result.session.turns));
      setStep("dialogue");
    } catch (error) {
      handleApiError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAnswer() {
    if (!practiceSession) return;

    const trimmed = answer.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setApiError(null);
    setSummarySaved(false);

    try {
      const result = await createPracticeTurn(practiceSession.id, {
        actorAnswer: trimmed,
      });
      const nextDialogue = [
        ...dialogue,
        {
          id: result.actorTurn.id,
          speaker: result.actorTurn.speaker,
          content: result.actorTurn.content,
          questionFocus: result.actorTurn.questionFocus,
        },
        {
          id: result.coachTurn.id,
          speaker: result.coachTurn.speaker,
          content: result.coachTurn.content,
          questionFocus: result.coachTurn.questionFocus,
        },
      ];

      setPracticeSession(result.session);
      setDialogue(nextDialogue);
      setAnswer("");

      if (result.dialogueComplete) {
        setFinalReflectionPrompt(result.coachTurn.content);
        setStep("summary");
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSummary() {
    if (!practiceSession) return;

    const latestActorAnswer = [...dialogue]
      .reverse()
      .find((entry) => entry.speaker === "actor")?.content;
    const trimmed = finalSentence.trim() || latestActorAnswer?.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const result = await createPracticeSummary(practiceSession.id, {
        finalActorSentence: trimmed,
      });
      setPracticeSession(result.session);
      setPracticeHistory((current) =>
        current.map((item) =>
          item.id === result.session.id ? result.session : item,
        ),
      );
      setFinalSentence(result.session.finalActorSentence ?? trimmed);
      setNextReflectionQuestion(result.nextReflectionQuestion);
      setSummarySaved(true);
    } catch (error) {
      handleApiError(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "gate" || !session) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-10">
        <p className="rounded-3xl bg-white p-6 text-[#4e5968] shadow-sm">
          {loadingMessage}
        </p>
      </main>
    );
  }

  if (step === "home") {
    return (
      <PracticeHome
        displayName={formatDisplayName(session)}
        historyError={historyError}
        historyLoading={historyLoading}
        historySessions={practiceHistory}
      />
    );
  }

  if (step === "history") {
    return (
      <PracticeHistoryScreen
        displayName={formatDisplayName(session)}
        error={historyError}
        loading={historyLoading}
        sessions={practiceHistory}
      />
    );
  }

  if (step === "video") {
    return (
      <PracticeNewScreen
        apiError={apiError}
        submitting={submitting}
        onUploadFileSelect={selectUploadFile}
      />
    );
  }

  if (step === "context") {
    return (
      <PracticeContextScreen
        apiError={apiError}
        scene={scene}
        submitting={submitting}
        uploadFile={uploadFile}
        uploadPreviewUrl={uploadPreviewUrl}
        onBack={returnToUploadSelection}
        onSceneChange={updateScene}
        onSubmit={() => startUpload(uploadFile)}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-8 text-[#191f28] sm:px-8">
      <header className="flex flex-col gap-5 rounded-[2rem] bg-white p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#3182f6]">
            Acttub 연습 공간
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
            영상을 올리고, 한 번에 하나씩 장면의 생각을 붙잡아요.
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-[#4e5968]">
            질문은 사용자가 남긴 맥락과 확인한 관찰만 바탕으로 이어집니다.
            마지막 문장은 사용자가 직접 작성해요.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="rounded-2xl bg-[#f2f4f6] px-4 py-3 text-sm text-[#4e5968]">
            <p>{session.user?.email ?? session.user?.id ?? "Supabase 사용자"}</p>
            <p className="mt-1 text-[#8b95a1]">{session.mode}</p>
          </div>
          <a
            href="/auth/logout"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-semibold text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
          >
            로그아웃
          </a>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-[2rem] bg-white p-6 shadow-sm">
          {apiError ? (
            <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
              {apiError}
            </p>
          ) : null}
          {step === "upload" ? <UploadProgress /> : null}
          {step === "observe" ? (
            observation ? (
              <ObservationPanel
                observation={observation}
                submitting={submitting}
                onConfirm={confirmObservation}
              />
            ) : (
              <p className="rounded-2xl bg-[#f9fafb] p-4 text-sm text-[#4e5968]">
                Supabase에 저장된 관찰을 불러오는 중이에요.
              </p>
            )
          ) : null}
          {step === "dialogue" ? (
            <DialoguePanel
              answer={answer}
              answerCount={actorAnswers.length}
              dialogue={dialogue}
              onAnswerChange={setAnswer}
              onSubmit={submitAnswer}
              onFinish={finishDialogue}
              submitting={submitting}
            />
          ) : null}
          {step === "summary" ? (
            <SummaryPanel
              finalSentence={finalSentence}
              finalReflectionPrompt={finalReflectionPrompt}
              onFinalSentenceChange={updateFinalSentence}
              scene={scene}
              dialogue={dialogue}
              nextReflectionQuestion={nextReflectionQuestion}
              summarySaved={summarySaved}
              hidden={hidden}
              submitting={submitting}
              onSave={saveSummary}
              onToggleHidden={() => setHidden((value) => !value)}
            />
          ) : null}
        </section>

        <aside className="space-y-4">
          <ProgressCard step={step} />
          <SessionCard
            scene={scene}
            observation={observation}
            answerCount={actorAnswers.length}
            hidden={hidden}
          />
        </aside>
      </div>
    </main>
  );
}

function PracticeHome({
  displayName,
  historyError,
  historyLoading,
  historySessions,
}: {
  displayName: string;
  historyError: string | null;
  historyLoading: boolean;
  historySessions: CoachSessionDto[];
}) {
  const hasHistory = historySessions.length > 0;
  let description =
    "아직 연습 기록이 비어 있어요. 첫 영상을 올리면 장면 맥락과 함께 질문을 받을 수 있어요.";

  if (historyLoading) {
    description =
      "연습 기록을 불러오는 중이에요. 곧 이어서 볼 수 있는 장면을 정리해둘게요.";
  } else if (hasHistory) {
    description = "최근 연습을 확인하거나 새 영상을 올려 다음 질문을 받아보세요.";
  }

  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header className="rounded-[32px] bg-[#f7faff] p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <AppLogoMark />
                <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                  AI 연기 코치
                </p>
              </div>
              <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl lg:text-[40px]">
                {displayName}님, 환영해요
              </h1>
              <p className="mt-3 max-w-3xl text-base font-bold leading-7 tracking-[-0.02em] text-[#8b95a1] sm:text-lg sm:leading-8 lg:text-xl">
                {description}
              </p>
            </div>
            <a
              href="/auth/logout"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
            >
              로그아웃
            </a>
          </div>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a
              href="/practice/new"
              className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-[#2f6bff] px-6 py-3 text-base font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da]"
            >
              새 연습 시작하기
            </a>
            <a
              href="/practice/history"
              className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-white px-6 py-3 text-base font-black text-[#2f6bff] shadow-sm transition hover:text-[#1b64da]"
            >
              전체 보기
            </a>
          </div>
        </header>

        <RecentPracticeSection
          error={historyError}
          loading={historyLoading}
          sessions={historySessions}
        />
      </div>
    </main>
  );
}

function PracticeNewScreen({
  apiError,
  submitting,
  onUploadFileSelect,
}: {
  apiError: string | null;
  submitting: boolean;
  onUploadFileSelect: (file: File) => void;
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
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              오늘의 연기 영상을 올려 주세요
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              파일을 고른 뒤 장르, 상황, 인물 맥락을 적으면 질문 흐름이 시작돼요.
            </p>
          </div>
          <a
            href="/home"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
          >
            홈으로
          </a>
        </header>

        {apiError ? (
          <p className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
            {apiError}
          </p>
        ) : null}

        <VideoDropZone
          submitting={submitting}
          onUploadFileSelect={onUploadFileSelect}
        />
      </div>
    </main>
  );
}

function PracticeHistoryScreen({
  displayName,
  error,
  loading,
  sessions,
}: {
  displayName: string;
  error: string | null;
  loading: boolean;
  sessions: CoachSessionDto[];
}) {
  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
              <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                연습 기록
              </p>
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              {displayName}님의 전체 연습
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              완료한 연습 노트와 이어서 볼 질문 흐름을 한곳에 모았어요.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/home"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
            >
              홈
            </a>
            <a
              href="/practice/new"
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2f6bff] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]"
            >
              새 연습
            </a>
          </div>
        </header>

        <RecentPracticeSection
          error={error}
          loading={loading}
          sessions={sessions}
          variant="full"
        />
      </div>
    </main>
  );
}

function PracticeContextScreen({
  apiError,
  scene,
  submitting,
  uploadFile,
  uploadPreviewUrl,
  onBack,
  onSceneChange,
  onSubmit,
}: {
  apiError: string | null;
  scene: SceneDraft;
  submitting: boolean;
  uploadFile: File | null;
  uploadPreviewUrl: string | null;
  onBack: () => void;
  onSceneChange: <K extends keyof SceneDraft>(
    key: K,
    value: SceneDraft[K],
  ) => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <main className="min-h-dvh bg-[#f8fafc] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <button
          type="button"
          disabled={submitting}
          onClick={onBack}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]"
        >
          ← 영상 다시 선택
        </button>

        <header className="mt-6 rounded-[28px] bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black text-[#2f6bff]">2단계 · 장면 텍스트</p>
          <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
            영상에 붙일 사용자의 텍스트를 입력해 주세요
          </h1>
          <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
            장르, 상황, 인물 맥락을 적으면 질문이 실제 장면에 더 정확히
            기대게 됩니다.
          </p>
        </header>

        {apiError ? (
          <p className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
            {apiError}
          </p>
        ) : null}

        <section className="mt-6 grid gap-4 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[#eaf2ff] text-[#2f6bff]">
              <UploadIcon />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black text-[#8b95a1]">선택된 영상</p>
              <p className="mt-1 truncate text-lg font-black tracking-[-0.04em]">
                {uploadFile?.name ?? "파일을 다시 선택해 주세요"}
              </p>
              {uploadFile ? (
                <p className="mt-1 text-sm font-bold text-[#b0b8c1]">
                  {formatFileSize(uploadFile.size)}
                </p>
              ) : null}
            </div>
          </div>
          <SelectedUploadPreview
            file={uploadFile}
            previewUrl={uploadPreviewUrl}
          />
        </section>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <SceneContextForm
            scene={scene}
            submitting={submitting}
            onSceneChange={onSceneChange}
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_2fr]">
            <button
              type="button"
              disabled={submitting}
              onClick={onBack}
              className="min-h-13 rounded-2xl border border-[#d1d6db] bg-white px-5 py-3 font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]"
            >
              다른 영상 선택
            </button>
            <button
              type="submit"
              disabled={submitting || !uploadFile}
              className="min-h-13 rounded-2xl bg-[#2f6bff] px-5 py-3 font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]"
            >
              {submitting ? "업로드 준비 중이에요" : "입력 완료하고 질문 받기"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function SelectedUploadPreview({
  file,
  previewUrl,
}: {
  file: File | null;
  previewUrl: string | null;
}) {
  const [previewError, setPreviewError] = useState(false);

  if (!file || !previewUrl) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl bg-[#f2f4f6] text-sm font-bold text-[#8b95a1]">
        미리보기 대기
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-2xl bg-[#fff4f4] px-5 text-center text-sm font-bold leading-6 text-[#e42939]">
        <span>이 브라우저에서 선택한 영상을 재생할 수 없어요.</span>
        <span className="mt-1 text-[#8b95a1]">
          MP4(H.264) 형식으로 변환한 뒤 다시 시도해 주세요.
        </span>
      </div>
    );
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

function AppLogoMark() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6bff] text-white shadow-[0_8px_20px_rgba(49,130,246,0.2)]">
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-4 border-white">
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
      </span>
    </span>
  );
}

function SceneContextForm({
  scene,
  submitting,
  onSceneChange,
}: {
  scene: SceneDraft;
  submitting: boolean;
  onSceneChange: <K extends keyof SceneDraft>(
    key: K,
    value: SceneDraft[K],
  ) => void;
}) {
  function applyPracticeExample() {
    onSceneChange("genre", practiceExample.genre);
    onSceneChange("situation", practiceExample.situation);
    onSceneChange("characterContext", practiceExample.characterContext);
    onSceneChange("subtext", practiceExample.subtext);
  }

  return (
    <section className="mt-8 rounded-[24px] border border-[#e5e8eb] bg-[#fbfcfd] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black text-[#2f6bff]">장면 맥락</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.05em]">
            질문이 실제 장면에 기대도록 맥락을 적어 주세요
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8b95a1]">
            입력한 맥락과 Supabase에 저장된 세션 기록만 서버 질문 생성에 전달됩니다.
          </p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={applyPracticeExample}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-2xl border border-[#b0d2ff] bg-white px-4 py-2 text-sm font-black text-[#2f6bff] transition hover:border-[#3182f6] hover:bg-[#f7faff] disabled:border-[#e5e8eb] disabled:text-[#b0b8c1]"
        >
          테스트 예시 채우기
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="flex items-center gap-2 text-sm font-bold text-[#4e5968]">
            장르 / 작품 유형 <RequiredBadge />
          </span>
          <select
            value={scene.genre}
            disabled={submitting}
            required
            onChange={(event) => onSceneChange("genre", event.target.value)}
            className="mt-2 h-12 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-semibold outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          >
            <option value="">선택해 주세요</option>
            {genreOptions.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </label>
        <label className="block lg:col-span-2">
          <span className="flex items-center gap-2 text-sm font-bold text-[#4e5968]">
            상황 <RequiredBadge />
          </span>
          <input
            required
            value={scene.situation}
            disabled={submitting}
            onChange={(event) => onSceneChange("situation", event.target.value)}
            placeholder="장면에서 지금 벌어지는 일을 적어 주세요"
            className="mt-2 h-12 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-semibold outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="flex items-center gap-2 text-sm font-bold text-[#4e5968]">
            인물 맥락 <RequiredBadge />
          </span>
          <textarea
            required
            value={scene.characterContext}
            disabled={submitting}
            onChange={(event) => onSceneChange("characterContext", event.target.value)}
            placeholder="인물의 관계, 목표, 직전 상황을 적어 주세요"
            className="mt-2 min-h-28 w-full rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          />
        </label>
        <label className="block">
          <span className="flex items-center gap-2 text-sm font-bold text-[#4e5968]">
            서브텍스트 <OptionalBadge />
          </span>
          <textarea
            value={scene.subtext ?? ""}
            disabled={submitting}
            onChange={(event) => onSceneChange("subtext", event.target.value)}
            placeholder="아직 정하지 않았다면 비워 두세요"
            className="mt-2 min-h-28 w-full rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          />
        </label>
      </div>
    </section>
  );
}

function RequiredBadge() {
  return (
    <span className="rounded-full bg-[#eaf2ff] px-2 py-0.5 text-xs font-black text-[#2f6bff]">
      필수
    </span>
  );
}

function OptionalBadge() {
  return (
    <span className="rounded-full bg-[#f2f4f6] px-2 py-0.5 text-xs font-black text-[#8b95a1]">
      선택
    </span>
  );
}

function VideoDropZone({
  submitting,
  onUploadFileSelect,
}: {
  submitting: boolean;
  onUploadFileSelect: (file: File) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  function selectFile(file: File | null) {
    if (!file || submitting) return;
    onUploadFileSelect(file);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  return (
    <label
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={handleDrop}
      className={`group mt-8 flex min-h-[240px] items-center justify-center rounded-[24px] border-2 border-dashed px-4 py-8 text-center transition sm:min-h-[280px] lg:min-h-[320px] ${
        dragActive
          ? "border-[#3182f6] bg-[#eef6ff]"
          : "border-[#c8d9f7] bg-[#f7faff] hover:border-[#3182f6] hover:bg-[#f3f8ff]"
      } ${submitting ? "cursor-wait" : "cursor-pointer"}`}
    >
      <input
        type="file"
        accept="video/mp4,video/quicktime"
        disabled={submitting}
        onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
        className="sr-only"
      />
      <span className="flex flex-col items-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#eaf2ff] text-[#2f6bff] sm:h-16 sm:w-16">
          <UploadIcon />
        </span>
        <span className="mt-5 block text-xl font-black tracking-[-0.04em] sm:text-2xl">
          여기로 연습 영상을 끌어다 놓으세요
        </span>
        <span className="mt-2 block text-base font-bold text-[#b0b8c1] sm:text-lg">
          또는
        </span>
        <span className="mt-4 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-6 text-base font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition group-hover:bg-[#1b64da] sm:min-h-14 sm:px-7 sm:text-lg">
          {submitting ? "업로드 준비 중" : "파일 선택하기"}
        </span>
        <span className="mt-4 block text-sm font-bold tracking-[0.04em] text-[#b0b8c1] sm:text-base">
          MP4 · MOV · 최대 {uploadSizeLimitLabel} · 5분 이내 권장
        </span>
      </span>
    </label>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-7 w-7 sm:h-8 sm:w-8"
      fill="none"
      viewBox="0 0 48 48"
    >
      <path
        d="M24 33V11m0 0-8 8m8-8 8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="M12 31v4a6 6 0 0 0 6 6h12a6 6 0 0 0 6-6v-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  );
}

function RecentPracticeSection({
  error,
  loading,
  sessions,
  variant = "recent",
}: {
  error: string | null;
  loading: boolean;
  sessions: CoachSessionDto[];
  variant?: "recent" | "full";
}) {
  const visibleSessions = variant === "full" ? sessions : sessions.slice(0, 3);
  const title = variant === "full" ? "전체 연습 기록" : "최근 연습";

  return (
    <section id="recent-practices" className="mt-10 pb-10">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-black tracking-[-0.05em]">{title}</h2>
        {variant === "recent" && sessions.length > 0 ? (
          <a
            href="/practice/history"
            className="text-base font-black text-[#2f6bff] transition hover:text-[#1b64da]"
          >
            전체 보기
          </a>
        ) : null}
      </header>
      {loading ? (
        <p className="mt-5 rounded-2xl bg-[#f9fafb] px-4 py-3 text-sm font-bold text-[#6b7684]">
          이전 기록을 불러오는 중이에요.
        </p>
      ) : null}
      {error ? (
        <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
          {error}
        </p>
      ) : null}
      {!loading && !error && visibleSessions.length === 0 ? (
        <div className="mt-5 rounded-[24px] border border-dashed border-[#c8d9f7] bg-[#f7faff] p-8 text-center">
          <p className="text-xl font-black tracking-[-0.04em]">아직 연습 기록이 없어요</p>
          <p className="mt-2 text-sm font-bold leading-6 text-[#8b95a1]">
            첫 영상을 올리면 이곳에 연습 노트와 질문 흐름이 쌓입니다.
          </p>
          <a
            href="/practice/new"
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]"
          >
            첫 연습 시작하기
          </a>
        </div>
      ) : null}
      {!loading && !error && visibleSessions.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSessions.map((session) => (
            <PracticeHistoryCard key={session.id} session={session} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PracticeHistoryCard({ session }: { session: CoachSessionDto }) {
  const badge = getPracticeCardBadge(session);

  return (
    <article className="overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.045)]">
      <div
        className="relative flex aspect-[2.78/1] items-center justify-center bg-[#1f2937]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #202938 0 22px, #182131 22px 44px)",
        }}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#191f28] shadow-sm">
          <PlayIcon />
        </span>
        <span className="absolute bottom-3 right-3 rounded-lg bg-[#0f1724]/90 px-2.5 py-1 text-sm font-black text-white">
          {formatDuration(session.take.durationMs)}
        </span>
      </div>
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black tracking-[-0.04em]">
              {formatPracticeTitle(session)}
            </h3>
            <p className="mt-2 truncate text-base font-bold tracking-[-0.02em] text-[#8b95a1]">
              {formatPracticeSummary(session)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-black ${
              badge.tone === "positive"
                ? "bg-[#e5f8ef] text-[#009959]"
                : "bg-[#f2f4f6] text-[#4e5968]"
            }`}
          >
            {badge.label}
          </span>
        </div>
        <p className="mt-4 text-sm font-bold text-[#b0b8c1]">
          {formatRelativePracticeDate(session.updatedAt)}
        </p>
      </div>
    </article>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="ml-0.5 h-5 w-5"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1.06 1.06 0 0 0 8 5.6Z" />
    </svg>
  );
}

function formatDisplayName(session: AuthSessionResponse): string {
  const email = session.user?.email;

  if (!email) {
    return "배우";
  }

  const localPart = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return localPart || "배우";
}

function formatPracticeTitle(session: CoachSessionDto): string {
  return `${session.genre || "장르 미입력"} · ${session.situation || "상황 미입력"}`;
}

function formatPracticeSummary(session: CoachSessionDto): string {
  const actorTurn = [...session.turns]
    .reverse()
    .find((turn) => turn.speaker === "actor");

  return (
    session.finalActorSentence ??
    actorTurn?.content ??
    "첫 질문을 준비하고 있어요"
  );
}

function getPracticeCardBadge(session: CoachSessionDto): {
  label: string;
  tone: "neutral" | "positive";
} {
  if (session.status === "END") {
    return { label: "완료", tone: "positive" };
  }

  if (session.turns.length > 0) {
    return { label: `질문 ${session.turns.length}`, tone: "neutral" };
  }

  return { label: formatSessionStatus(session.status), tone: "neutral" };
}

function formatRelativePracticeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 없음";

  const diffMs = Date.now() - date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / dayMs);

  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 14) return "지난주";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return "--:--";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))}KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatSessionStatus(status: SessionStatus): string {
  const labels: Record<SessionStatus, string> = {
    ANALYZING: "분석 중",
    OBSERVE_CONFIRM: "관찰 확인",
    PROBE_LOOP: "질문 진행",
    INSIGHT: "정리됨",
    END: "완료",
  };

  return labels[status];
}

function UploadProgress() {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">영상 준비</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">
        연습 자료를 정리하고 있어요.
      </h2>
      <div className="h-3 overflow-hidden rounded-full bg-[#e5e8eb]">
        <div className="h-full w-3/4 rounded-full bg-[#3182f6]" />
      </div>
      <p className="leading-7 text-[#4e5968]">
        업로드 의도와 비공개 저장 경로를 확인하는 중이에요.
      </p>
    </div>
  );
}

function ObservationPanel({
  observation,
  submitting,
  onConfirm,
}: {
  observation: ObservationDto;
  submitting: boolean;
  onConfirm: (state: ConfirmationState) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">관찰 확인</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">
        이 관찰을 질문 근거로 써도 될까요?
      </h2>
      <div className="rounded-3xl bg-[#f9fafb] p-5">
        <p className="text-lg leading-8">“{observation.observationText}”</p>
        <p className="mt-3 text-sm text-[#8b95a1]">
          {Math.round(observation.timestampStartMs / 1000)}초 부근
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ChoiceButton
          disabled={submitting}
          onClick={() => onConfirm("accepted")}
        >
          맞아요
        </ChoiceButton>
        <ChoiceButton disabled={submitting} onClick={() => onConfirm("unsure")}>
          조금 다르게 볼래요
        </ChoiceButton>
        <ChoiceButton
          disabled={submitting}
          onClick={() => onConfirm(excludedObservationState)}
        >
          아니에요
        </ChoiceButton>
      </div>
    </div>
  );
}

function DialoguePanel({
  answer,
  answerCount,
  dialogue,
  onAnswerChange,
  onSubmit,
  onFinish,
  submitting,
}: {
  answer: string;
  answerCount: number;
  dialogue: DialogueEntry[];
  onAnswerChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onFinish: () => void;
  submitting: boolean;
}) {
  const endOfDialogueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfDialogueRef.current?.scrollIntoView({ block: "nearest" });
  }, [dialogue, submitting]);

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_12px_32px_rgba(25,31,40,0.06)]">
      <header className="flex flex-col gap-4 border-b border-[#e5e8eb] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6bff] text-sm font-black text-white">
            AI
          </span>
          <div>
            <h2 className="font-black tracking-[-0.03em]">AI 연기 코치</h2>
            <p className="mt-0.5 text-xs font-bold text-[#8b95a1]">
              답변 {answerCount}회 · 최대 {MAX_DIALOGUE_ANSWER_COUNT}회
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={onFinish}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#f04452] hover:text-[#e42939] disabled:text-[#b0b8c1]"
        >
          대화 종료하기
        </button>
      </header>

      <div
        role="log"
        aria-live="polite"
        aria-label="AI 코치와 나눈 대화"
        className="min-h-[320px] max-h-[520px] space-y-4 overflow-y-auto bg-[#f7f8fa] px-4 py-5 sm:px-5"
      >
        {dialogue.map((entry) => {
          const isActorEntry = entry.speaker === "actor";

          return (
            <div
              key={entry.id}
              className={`flex items-end gap-2 ${isActorEntry ? "justify-end" : "justify-start"}`}
            >
              {!isActorEntry ? (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white"
                >
                  AI
                </span>
              ) : null}
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-sm ${
                  isActorEntry
                    ? "rounded-br-md bg-[#3182f6] text-white"
                    : "rounded-bl-md border border-[#e5e8eb] bg-white text-[#191f28]"
                }`}
              >
                <p className="text-xs font-black opacity-70">
                  {isActorEntry ? "나" : "AI 코치"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">
                  {entry.content}
                </p>
              </div>
            </div>
          );
        })}
        {submitting ? (
          <div className="flex items-end gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white"
            >
              AI
            </span>
            <div className="rounded-2xl rounded-bl-md border border-[#e5e8eb] bg-white px-4 py-3 text-sm font-bold text-[#8b95a1] shadow-sm">
              다음 질문을 생각하고 있어요…
            </div>
          </div>
        ) : null}
        <div ref={endOfDialogueRef} />
      </div>

      <div className="border-t border-[#e5e8eb] bg-white p-4 sm:p-5">
        <div className="flex items-end gap-3 rounded-2xl border border-[#d1d6db] bg-white p-3 focus-within:border-[#3182f6] focus-within:ring-4 focus-within:ring-[#e8f3ff]">
          <textarea
            aria-label="AI 코치에게 보낼 답변"
            rows={2}
            value={answer}
            disabled={submitting}
            onChange={(event) => onAnswerChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (answer.trim() && !submitting) void onSubmit();
              }
            }}
            placeholder="답변을 입력해 주세요. Shift + Enter로 줄바꿈할 수 있어요."
            className="max-h-36 min-h-14 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] font-semibold leading-6 outline-none placeholder:text-[#b0b8c1] disabled:text-[#8b95a1]"
          />
          <button
            type="button"
            disabled={submitting || !answer.trim()}
            onClick={onSubmit}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[#3182f6] px-5 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]"
          >
            {submitting ? "전송 중" : "보내기"}
          </button>
        </div>
        <p className="mt-3 text-center text-xs font-bold leading-5 text-[#8b95a1]">
          {MIN_DIALOGUE_ANSWER_COUNT}회부터 AI가 대화가 충분한지 판단하고, 최대 {MAX_DIALOGUE_ANSWER_COUNT}회에 마무리해요.
        </p>
      </div>
    </div>
  );
}

function SummaryPanel({
  finalSentence,
  finalReflectionPrompt,
  onFinalSentenceChange,
  scene,
  dialogue,
  nextReflectionQuestion,
  summarySaved,
  hidden,
  submitting,
  onSave,
  onToggleHidden,
}: {
  finalSentence: string;
  finalReflectionPrompt: string;
  onFinalSentenceChange: (value: string) => void;
  scene: SceneDraft;
  dialogue: DialogueEntry[];
  nextReflectionQuestion: string;
  summarySaved: boolean;
  hidden: boolean;
  submitting: boolean;
  onSave: () => void;
  onToggleHidden: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">AI 정리</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">
        연습 노트로 마무리해요.
      </h2>
      <div className="flex items-end gap-2 rounded-3xl bg-[#f7f8fa] p-4">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white"
        >
          AI
        </span>
        <p className="rounded-2xl rounded-bl-md border border-[#e5e8eb] bg-white px-4 py-3 text-sm font-semibold leading-6 text-[#333d4b] shadow-sm">
          {finalReflectionPrompt ||
            "지금까지 대화에서 발견한 인물의 마음을 마지막 한 문장으로 남겨 볼까요?"}
        </p>
      </div>
      <textarea
        value={finalSentence}
        disabled={submitting || summarySaved}
        onChange={(event) => onFinalSentenceChange(event.target.value)}
        placeholder="예: 지금은 물러서지만, 이 마음을 끝까지 숨기지는 않겠다."
        className="min-h-32 w-full rounded-3xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6] disabled:text-[#6b7684]"
      />
      <div className="rounded-3xl bg-[#f9fafb] p-5 leading-7 text-[#4e5968]">
        <p className="font-semibold text-[#191f28]">연습 노트</p>
        <p className="mt-2">장르: {scene.genre || "아직 없음"}</p>
        <p>질문 흐름: {dialogue.length}개 기록</p>
        <p>마무리 문장: {finalSentence || "작성 전"}</p>
        {nextReflectionQuestion ? (
          <p>다음에 붙잡을 질문: {nextReflectionQuestion}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={submitting || summarySaved || !finalSentence.trim()}
        onClick={onSave}
        className="h-13 w-full rounded-2xl bg-[#3182f6] font-semibold text-white disabled:bg-[#b0d2ff]"
      >
        {submitting
          ? "저장 중이에요"
          : summarySaved
            ? "연습 노트 저장 완료"
            : "연습 노트 저장하기"}
      </button>
      {summarySaved ? (
        <p className="rounded-2xl bg-[#e5f8ef] px-4 py-3 text-sm font-semibold text-[#008a4e]">
          연습 노트가 저장됐어요.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href="/home"
          className="inline-flex h-13 items-center justify-center rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
        >
          홈으로
        </a>
        <a
          href="/practice/history"
          className="inline-flex h-13 items-center justify-center rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
        >
          기록 보기
        </a>
      </div>
      <button
        type="button"
        onClick={onToggleHidden}
        className="h-13 w-full rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968]"
      >
        {hidden ? "목록에 다시 보이기" : "목록에서 잠시 숨기기"}
      </button>
    </div>
  );
}

function ProgressCard({ step }: { step: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "video", label: "영상 선택" },
    { id: "context", label: "맥락 입력" },
    { id: "upload", label: "자료 준비" },
    { id: "observe", label: "관찰 확인" },
    { id: "dialogue", label: "질문 대화" },
    { id: "summary", label: "문장 남기기" },
  ];

  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm">
      <h2 className="font-bold">진행 흐름</h2>
      <ol className="mt-4 space-y-3">
        {steps.map((item) => (
          <li
            key={item.id}
            className={`rounded-2xl px-4 py-3 text-sm ${item.id === step ? "bg-[#e8f3ff] text-[#1b64da]" : "bg-[#f9fafb] text-[#6b7684]"}`}
          >
            {item.label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionCard({
  scene,
  observation,
  answerCount,
  hidden,
}: {
  scene: SceneDraft;
  observation: ObservationDto | null;
  answerCount: number;
  hidden: boolean;
}) {
  let observationLabel = "불러오는 중";

  if (observation?.confirmationState === "unasked") {
    observationLabel = "확인 전";
  } else if (observation) {
    observationLabel = "확인됨";
  }

  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm">
      <h2 className="font-bold">현재 세션</h2>
      <dl className="mt-4 space-y-3 text-sm text-[#4e5968]">
        <div>
          <dt className="font-semibold text-[#191f28]">장르</dt>
          <dd>{scene.genre || "입력 전"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">관찰 상태</dt>
          <dd>{observationLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">내 답변</dt>
          <dd>{answerCount}개</dd>
        </div>
        <div>
          <dt className="font-semibold text-[#191f28]">목록 표시</dt>
          <dd>{hidden ? "숨김" : "보임"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ChoiceButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-13 rounded-2xl border border-[#d1d6db] px-4 py-3 font-semibold text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]"
    >
      {children}
    </button>
  );
}
