"use client";

import { useEffect, useMemo, useState } from "react";
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
const summaryAnswerThreshold = 2;
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

export function PracticeFlow() {
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
  const [hidden, setHidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
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
          window.location.href = "/auth/login?next=/practice";
          return;
        }
        if (!authSession.terms.accepted) {
          window.location.href = "/terms";
          return;
        }
        setSession(authSession);
        setStep("scene");
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
  }, []);

  const actorAnswers = useMemo(
    () => dialogue.filter((entry) => entry.speaker === "actor"),
    [dialogue],
  );
  const latestQuestion = [...dialogue]
    .reverse()
    .find((entry) => entry.speaker === "coach");

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

  function selectUploadFile(file: File | null) {
    try {
      validateUploadFile(file);
      setUploadFile(file);
      setApiError(null);
      setStep("context");
    } catch (error) {
      setUploadFile(null);
      handleApiError(error);
      setStep("scene");
    }
  }

  function returnToUploadSelection() {
    setUploadFile(null);
    setApiError(null);
    setStep("scene");
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

        const finalizedUpload = await finalizePracticeUploadIntent(uploadIntent.uploadIntentId, {
          storagePath: uploadIntent.storagePath,
          durationMs: scene.durationMs,
        });
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
      setStep(result.session.observations[0] ? "observe" : "dialogue");
    } catch (error) {
      handleApiError(error);
      setStep(selectedFile ? "context" : "scene");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmObservation(confirmationState: ConfirmationState) {
    if (!practiceSession || !observation) return;

    setSubmitting(true);
    setApiError(null);

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

    const answerCount = actorAnswers.length;

    setSubmitting(true);
    setApiError(null);

    try {
      const result = await createPracticeTurn(practiceSession.id, {
        actorAnswer: trimmed,
      });
      setPracticeSession(result.session);
      setDialogue((current) => [
        ...current,
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
      ]);
      setAnswer("");

      if (answerCount >= 1) {
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

    const trimmed = finalSentence.trim();
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

  if (step === "scene") {
    return (
      <PracticeHome
        apiError={apiError}
        displayName={formatDisplayName(session)}
        historyError={historyError}
        historyLoading={historyLoading}
        historySessions={practiceHistory}
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
              latestQuestion={latestQuestion?.content ?? "다음 질문을 준비하고 있어요."}
              answer={answer}
              dialogue={dialogue}
              onAnswerChange={setAnswer}
              onSubmit={submitAnswer}
              onFinish={() => setStep("summary")}
              submitting={submitting}
            />
          ) : null}
          {step === "summary" ? (
            <SummaryPanel
              finalSentence={finalSentence}
              onFinalSentenceChange={setFinalSentence}
              scene={scene}
              dialogue={dialogue}
              nextReflectionQuestion={nextReflectionQuestion}
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
  apiError,
  displayName,
  historyError,
  historyLoading,
  historySessions,
  submitting,
  onUploadFileSelect,
}: {
  apiError: string | null;
  displayName: string;
  historyError: string | null;
  historyLoading: boolean;
  historySessions: CoachSessionDto[];
  submitting: boolean;
  onUploadFileSelect: (file: File) => void;
}) {
  const hasHistory = historySessions.length > 0;
  const description = historyLoading
    ? "연습 기록을 불러오는 중이에요. 곧 이어서 볼 수 있는 장면을 정리해둘게요."
    : hasHistory
      ? "최근 연습을 이어서 확인하거나, 새 영상을 먼저 올린 뒤 장면 맥락을 붙여보세요."
      : "아직 연습 기록이 비어 있어요. 첫 영상을 올리면 다음 화면에서 장면 맥락을 받을게요.";

  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header>
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

        <RecentPracticeSection
          error={historyError}
          loading={historyLoading}
          sessions={historySessions}
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
  onBack,
  onSceneChange,
  onSubmit,
}: {
  apiError: string | null;
  scene: SceneDraft;
  submitting: boolean;
  uploadFile: File | null;
  onBack: () => void;
  onSceneChange: <K extends keyof SceneDraft>(key: K, value: SceneDraft[K]) => void;
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

        <section className="mt-6 flex items-center gap-4 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm">
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
  onSceneChange: <K extends keyof SceneDraft>(key: K, value: SceneDraft[K]) => void;
}) {
  return (
    <section className="mt-8 rounded-[24px] border border-[#e5e8eb] bg-[#fbfcfd] p-5 sm:p-6">
      <div>
        <p className="text-sm font-black text-[#2f6bff]">장면 맥락</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.05em]">
          질문이 실제 장면에 기대도록 맥락을 적어 주세요
        </h2>
        <p className="mt-2 text-sm font-bold leading-6 text-[#8b95a1]">
          입력한 맥락과 Supabase에 저장된 세션 기록만 서버 질문 생성에 전달됩니다.
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="text-sm font-bold text-[#4e5968]">장르 / 작품 유형</span>
          <input
            value={scene.genre}
            disabled={submitting}
            onChange={(event) => onSceneChange("genre", event.target.value)}
            placeholder="예: 현대극, 독백, 오디션 장면"
            className="mt-2 h-12 w-full rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-semibold outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="text-sm font-bold text-[#4e5968]">상황</span>
          <input
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
          <span className="text-sm font-bold text-[#4e5968]">인물 맥락</span>
          <textarea
            value={scene.characterContext}
            disabled={submitting}
            onChange={(event) => onSceneChange("characterContext", event.target.value)}
            placeholder="인물의 관계, 목표, 직전 상황을 적어 주세요"
            className="mt-2 min-h-28 w-full rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 outline-none focus:border-[#3182f6] disabled:bg-[#f2f4f6]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-[#4e5968]">서브텍스트 선택 입력</span>
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
}: {
  error: string | null;
  loading: boolean;
  sessions: CoachSessionDto[];
}) {
  const visibleSessions = sessions.slice(0, 3);

  return (
    <section id="recent-practices" className="mt-10 pb-10">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-black tracking-[-0.05em]">최근 연습</h2>
        {visibleSessions.length > 0 ? (
          <a
            href="#recent-practices"
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
      {!loading && !error && visibleSessions.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSessions.map((session, index) => (
            <PracticeHistoryCard
              key={session.id}
              index={index}
              session={session}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PracticeHistoryCard({
  index,
  session,
}: {
  index: number;
  session: CoachSessionDto;
}) {
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
          {formatDuration(session.take.durationMs, index)}
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

function formatDuration(durationMs: number | null, index: number): string {
  void index;

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
  latestQuestion,
  answer,
  dialogue,
  onAnswerChange,
  onSubmit,
  onFinish,
  submitting,
}: {
  latestQuestion: string;
  answer: string;
  dialogue: DialogueEntry[];
  onAnswerChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onFinish: () => void;
  submitting: boolean;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">한 번에 하나씩</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">
        {latestQuestion}
      </h2>
      <div className="max-h-72 space-y-3 overflow-auto rounded-3xl bg-[#f9fafb] p-4">
        {dialogue.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-2xl p-4 ${entry.speaker === "coach" ? "bg-white text-[#191f28]" : "bg-[#3182f6] text-white"}`}
          >
            <p className="text-xs font-semibold opacity-70">
              {entry.speaker === "coach" ? "질문" : "내 답"}
            </p>
            <p className="mt-1 leading-7">{entry.content}</p>
          </div>
        ))}
      </div>
      <textarea
        value={answer}
        onChange={(event) => onAnswerChange(event.target.value)}
        placeholder="떠오른 생각을 한두 문장으로 적어 주세요."
        className="min-h-32 w-full rounded-3xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmit}
          className="h-13 rounded-2xl bg-[#3182f6] font-semibold text-white disabled:bg-[#b0d2ff]"
        >
          {submitting ? "기록 중이에요" : "답하고 다음 질문 보기"}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onFinish}
          className="h-13 rounded-2xl border border-[#d1d6db] font-semibold text-[#4e5968] disabled:text-[#b0b8c1]"
        >
          마지막 문장 쓰기
        </button>
      </div>
    </div>
  );
}

function SummaryPanel({
  finalSentence,
  onFinalSentenceChange,
  scene,
  dialogue,
  nextReflectionQuestion,
  hidden,
  submitting,
  onSave,
  onToggleHidden,
}: {
  finalSentence: string;
  onFinalSentenceChange: (value: string) => void;
  scene: SceneDraft;
  dialogue: DialogueEntry[];
  nextReflectionQuestion: string;
  hidden: boolean;
  submitting: boolean;
  onSave: () => void;
  onToggleHidden: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-[#3182f6]">마무리</p>
      <h2 className="text-2xl font-bold tracking-[-0.03em]">
        인물의 생각을 내 문장으로 남겨 주세요.
      </h2>
      <textarea
        value={finalSentence}
        onChange={(event) => onFinalSentenceChange(event.target.value)}
        placeholder="예: 지금은 물러서지만, 이 마음을 끝까지 숨기지는 않겠다."
        className="min-h-32 w-full rounded-3xl border border-[#d1d6db] p-4 outline-none focus:border-[#3182f6]"
      />
      <div className="rounded-3xl bg-[#f9fafb] p-5 leading-7 text-[#4e5968]">
        <p className="font-semibold text-[#191f28]">세션 요약</p>
        <p className="mt-2">장르: {scene.genre || "아직 없음"}</p>
        <p>질문 흐름: {dialogue.length}개 기록</p>
        <p>마지막 문장: {finalSentence || "작성 전"}</p>
        {nextReflectionQuestion ? (
          <p>다음에 붙잡을 질문: {nextReflectionQuestion}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={submitting || !finalSentence.trim()}
        onClick={onSave}
        className="h-13 w-full rounded-2xl bg-[#3182f6] font-semibold text-white disabled:bg-[#b0d2ff]"
      >
        {submitting ? "저장 중이에요" : "마지막 문장 저장하기"}
      </button>
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
    { id: "scene", label: "영상 선택" },
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
          <dd>
            {!observation
              ? "불러오는 중"
              : observation.confirmationState === "unasked"
                ? "확인 전"
                : "확인됨"}
          </dd>
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
