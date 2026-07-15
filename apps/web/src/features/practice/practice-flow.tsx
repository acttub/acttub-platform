"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { getAuthSession, type AuthSessionResponse } from "@/lib/api/auth";
import {
  ApiClientError,
  createPracticeReport,
  createPracticeSession,
  createPracticeUploadIntent,
  finalizePracticeUploadIntent,
  getPracticeSession,
  listPracticeSessions,
  mutatePracticeTurn,
  retryPracticeAnalysis,
  type PracticeSession,
} from "@/lib/api/sessions";
import type { ActingCoachSessionDto, ActingReportDto } from "@/lib/api/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  countUnicodeCodePoints,
  PRACTICE_INPUT_LIMITS,
  validateReplyText,
  validateSceneContext,
} from "@/lib/practice/input-limits";

const MAX_UPLOAD_BYTES = 576_716_800;
const MAX_DURATION_MS = 180_000;
type Entry = "home" | "new" | "history";
type Step = "home" | "history" | "video" | "context";

const entryPath: Record<Entry, string> = {
  home: "/home",
  new: "/practice/new",
  history: "/practice/history",
};

const entryInitialStep: Record<Entry, Step> = {
  home: "home",
  new: "video",
  history: "history",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했어요.";
}

async function videoDuration(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(Math.round(video.duration * 1000));
      video.onerror = () => reject(new Error("영상 길이를 확인하지 못했어요."));
      video.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export function PracticeFlow({ entry = "new" }: { entry?: Entry }) {
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>(entryInitialStep[entry]);
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [active, setActive] = useState<ActingCoachSessionDto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [situation, setSituation] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [subtext, setSubtext] = useState("");
  const [answer, setAnswer] = useState("");
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadPracticeSpace() {
      try {
        const auth = await getAuthSession();
        if (!auth.authenticated) {
          location.href = `/auth/login?next=${encodeURIComponent(entryPath[entry])}`;
          return;
        }
        if (!auth.terms.accepted) {
          location.href = "/terms";
          return;
        }
        if (!mounted) return;

        setAuthSession(auth);
        setStep(entryInitialStep[entry]);
        setHistoryError(null);

        try {
          const { sessions } = await listPracticeSessions();
          if (mounted) setHistory(sessions);
        } catch (reason) {
          if (mounted) setHistoryError(errorMessage(reason));
        } finally {
          if (mounted) setReady(true);
        }
      } catch (reason) {
        if (!mounted) return;
        setError(errorMessage(reason));
        setReady(true);
      }
    }

    void loadPracticeSpace();
    return () => { mounted = false; };
  }, [entry]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function selectUploadFile(nextFile: File | null) {
    if (!nextFile) return;
    if (nextFile.size <= 0 || nextFile.size > MAX_UPLOAD_BYTES) {
      setError("영상은 550MB 이하여야 해요.");
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
    setError(null);
    setStep("context");
  }

  function returnToVideoSelection() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    setError(null);
    setStep("video");
  }

  function openSession(session: PracticeSession) {
    if (session.legacy) return;
    setActive(session);
    if (session.status === "INTERVIEW" && !session.currentRun) {
      void operation("start", session);
    }
  }

  async function begin() {
    if (!file || !situation.trim() || !characterContext.trim() || !subtext.trim()) {
      setError("영상, 상황, 인물 정보와 서브텍스트를 모두 입력해 주세요."); return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) { setError("영상은 550MB 이하여야 해요."); return; }
    if (file.type !== "video/mp4" && file.type !== "video/quicktime") { setError("MP4 또는 MOV 영상만 업로드할 수 있어요."); return; }
    let sceneContext: ReturnType<typeof validateSceneContext>;
    try {
      sceneContext = validateSceneContext({ situation, characterContext, subtext });
    } catch (reason) {
      setError(errorMessage(reason));
      return;
    }
    setBusy(true); setError(null);
    let persistedSessionId: string | null = null;
    try {
      const durationMs = await videoDuration(file);
      if (durationMs < 1 || durationMs > MAX_DURATION_MS) throw new Error("영상은 3분 이하여야 해요.");
      const { uploadIntent } = await createPracticeUploadIntent({
        fileMetadata: { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
      });
      persistedSessionId = uploadIntent.sessionId;
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("업로드 설정을 확인하지 못했어요.");
      const { error: uploadError } = await supabase.storage.from(uploadIntent.storageBucket)
        .upload(uploadIntent.storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      await finalizePracticeUploadIntent(uploadIntent.uploadIntentId, { storagePath: uploadIntent.storagePath, durationMs });
      const session = await createPracticeSession({
        requestId: crypto.randomUUID(), uploadIntentId: uploadIntent.uploadIntentId,
        ...sceneContext,
      });
      setActive(session); setHistory((items) => [session, ...items.filter((item) => item.id !== session.id)]);
      if (session.status === "INTERVIEW" && !session.currentRun) {
        await operation("start", session);
      }
    } catch (reason) {
      if (persistedSessionId) await recoverPersistedSession(persistedSessionId, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function operation(kind: "start" | "restart", target: ActingCoachSessionDto | null = active) {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const session = await mutatePracticeTurn(target.id, { operation: kind, requestId: crypto.randomUUID() });
      setActive(session); setRestartRequired(false);
    } catch (reason) {
      await recoverPersistedSession(target.id, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function reply() {
    if (!active?.currentRun || !answer.trim()) return;
    let text: string;
    try {
      text = validateReplyText(answer);
    } catch (reason) {
      setError(errorMessage(reason));
      return;
    }
    setPendingAnswer(text);
    setBusy(true); setError(null);
    try {
      const session = await mutatePracticeTurn(active.id, {
        operation: "reply", runId: active.currentRun.runId, requestId: crypto.randomUUID(), text,
      });
      setActive(session); setAnswer("");
    } catch (reason) {
      await recoverPersistedSession(active.id, reason);
      setError(reason instanceof ApiClientError && reason.code === "acting_session_expired"
        ? "인터뷰 연결이 만료되었어요. 아래 버튼으로 새 인터뷰를 시작해 주세요."
        : errorMessage(reason));
    } finally { setPendingAnswer(null); setBusy(false); }
  }

  async function retryReply(actorTurnId: string) {
    if (!active?.currentRun) return;
    setBusy(true); setError(null);
    try {
      const session = await mutatePracticeTurn(active.id, {
        operation: "retry_reply",
        runId: active.currentRun.runId,
        requestId: crypto.randomUUID(),
        actorTurnId,
      });
      setActive(session);
    } catch (reason) {
      await recoverPersistedSession(active.id, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function retryAnalysis() {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const session = await retryPracticeAnalysis(active.id);
      setActive(session);
      if (session.status === "INTERVIEW" && !session.currentRun) {
        await operation("start", session);
      }
    } catch (reason) {
      await recoverPersistedSession(active.id, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function report() {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      await createPracticeReport(active.id);
      const { session } = await getPracticeSession(active.id);
      if (session.legacy) throw new Error("완료된 연습 리포트를 불러오지 못했어요.");
      setActive(session);
    } catch (reason) {
      await recoverPersistedSession(active.id, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function recoverPersistedSession(sessionId: string, reason: unknown) {
    if (!(reason instanceof ApiClientError) || ![
      "acting_session_expired",
      "upstream_outcome_unknown",
      "report_outcome_unknown",
      "acting_api_auth_failed",
      "acting_api_rate_limited",
      "acting_api_rejected",
      "analysis_outcome_unknown",
      "video_too_large",
    ].includes(reason.code)) return;

    if (["acting_session_expired", "upstream_outcome_unknown"].includes(reason.code)) {
      setRestartRequired(true);
    }
    try {
      const { session: persisted } = await getPracticeSession(sessionId);
      if (!persisted.legacy) {
        setActive(persisted);
        setRestartRequired(persisted.currentRun?.recoveryAction === "restart");
      }
    } catch {
      // Preserve the original operation error when recovery refresh is unavailable.
    }
  }

  if (!ready || !authSession) {
    return <LoadingScreen message={error ?? "연습 공간을 준비하는 중이에요."} />;
  }

  if (active) {
    return (
      <SessionView
        session={active}
        answer={answer}
        pendingAnswer={pendingAnswer}
        setAnswer={setAnswer}
        busy={busy}
        error={error}
        restartRequired={restartRequired}
        onStart={() => operation("start")}
        onRestart={() => operation("restart")}
        onReply={reply}
        onRetryReply={retryReply}
        onRetryAnalysis={retryAnalysis}
        onReport={report}
      />
    );
  }

  if (step === "home") {
    return (
      <PracticeHome
        displayName={formatDisplayName(authSession)}
        historyError={historyError}
        sessions={history}
        onOpen={openSession}
      />
    );
  }

  if (step === "history") {
    return (
      <PracticeHistoryScreen
        displayName={formatDisplayName(authSession)}
        historyError={historyError}
        sessions={history}
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
  const codePoints = countUnicodeCodePoints(value);
  return (
    <label className="grid gap-3 text-base font-black text-[#333d4b]">
      <span className="flex items-center gap-2">{label} <RequiredBadge /></span>
      <textarea
        className="min-h-28 rounded-2xl border border-[#d1d6db] bg-white p-4 text-sm font-semibold leading-6 text-[#191f28] outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6]"
        value={value}
        maxLength={PRACTICE_INPUT_LIMITS.sceneFieldCodePoints * 2}
        onChange={(event) => {
          if (countUnicodeCodePoints(event.target.value) <= PRACTICE_INPUT_LIMITS.sceneFieldCodePoints) {
            onChange(event.target.value);
          }
        }}
      />
      <span className="text-right text-xs font-bold text-[#8b95a1]">
        {codePoints.toLocaleString()} / {PRACTICE_INPUT_LIMITS.sceneFieldCodePoints.toLocaleString()}
      </span>
    </label>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7faff] px-5 py-10 text-[#191f28]">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-8 text-center shadow-[0_16px_48px_rgba(25,31,40,0.08)]">
        <span className="mx-auto"><AppLogoMark /></span>
        <p className="mt-5 text-base font-bold leading-7 text-[#4e5968]">{message}</p>
      </div>
    </main>
  );
}

function PracticeHome({
  displayName,
  historyError,
  sessions,
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  sessions: PracticeSession[];
  onOpen: (session: PracticeSession) => void;
}) {
  const description = historyError
    ? "연습 기록을 잠시 불러오지 못했지만 새 연습은 바로 시작할 수 있어요."
    : sessions.length > 0
      ? "최근 연습을 확인하거나 새 영상을 올려 다음 질문을 받아보세요."
      : "첫 영상을 올리면 장면을 분석하고, 연기를 더 깊게 만드는 질문을 시작할 수 있어요.";

  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header className="overflow-hidden rounded-[32px] bg-[#f7faff] p-6 shadow-sm sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <AppLogoMark />
                <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                  Acttub AI 연기 코치
                </p>
              </div>
              <h1 className="mt-6 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl lg:text-[42px]">
                {displayName}님, 오늘은 어떤 장면을 연습할까요?
              </h1>
              <p className="mt-4 max-w-3xl text-base font-bold leading-7 tracking-[-0.02em] text-[#8b95a1] sm:text-lg sm:leading-8">
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
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
              전체 기록 보기
            </a>
          </div>
        </header>

        <RecentPracticeSection error={historyError} sessions={sessions} onOpen={onOpen} />
      </div>
    </main>
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
                Acttub · 새 연습
              </p>
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              오늘의 연기 영상을 올려 주세요
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              영상을 고른 다음 장면과 인물의 맥락을 차근차근 입력할 수 있어요.
            </p>
          </div>
          <a
            href="/home"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]"
          >
            홈으로
          </a>
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
  onOpen,
}: {
  displayName: string;
  historyError: string | null;
  sessions: PracticeSession[];
  onOpen: (session: PracticeSession) => void;
}) {
  return (
    <main className="min-h-dvh bg-white px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1280px]">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
              <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                Acttub · 연습 기록
              </p>
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              {displayName}님의 전체 연습
            </h1>
            <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#8b95a1]">
              장면별 진행 상태와 완성된 리포트를 한곳에서 확인할 수 있어요.
            </p>
          </div>
          <div className="flex gap-2">
            <a href="/home" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">
              홈
            </a>
            <a href="/practice/new" className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2f6bff] px-4 text-sm font-black text-white transition hover:bg-[#1b64da]">
              새 연습
            </a>
          </div>
        </header>
        <RecentPracticeSection error={historyError} sessions={sessions} onOpen={onOpen} variant="full" />
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
          <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
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
            <button type="button" disabled={busy} onClick={onBack} className="min-h-13 rounded-2xl border border-[#d1d6db] bg-white px-5 py-3 font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da] disabled:text-[#b0b8c1]">
              다른 영상 선택
            </button>
            <button type="submit" disabled={busy || !file} className="min-h-13 rounded-2xl bg-[#2f6bff] px-5 py-3 font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
              {busy ? "업로드하고 분석하는 중…" : "입력 완료하고 분석 시작"}
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
  const aggregateCodePoints = [situation, characterContext, subtext]
    .reduce((total, value) => total + countUnicodeCodePoints(value), 0);
  const aggregateLimit = PRACTICE_INPUT_LIMITS.sceneAggregateCodePoints;
  return (
    <section className="mt-6 grid gap-6 rounded-[24px] border border-[#e5e8eb] bg-white p-5 shadow-sm sm:p-7">
      <p className={`text-right text-xs font-bold ${aggregateCodePoints > aggregateLimit ? "text-red-600" : "text-[#8b95a1]"}`}>
        전체 {aggregateCodePoints.toLocaleString()} / {aggregateLimit.toLocaleString()}
      </p>
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
        <span className="mt-4 inline-flex min-h-14 items-center justify-center rounded-2xl bg-[#2f6bff] px-7 text-lg font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition group-hover:bg-[#1b64da]">
          {busy ? "업로드 준비 중" : "파일 선택하기"}
        </span>
        <span className="mt-4 block text-sm font-bold tracking-[0.02em] text-[#b0b8c1] sm:text-base">
          MP4 · MOV · 최대 550MB · 3분 이내
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
  onOpen,
  variant = "recent",
}: {
  error?: string | null;
  sessions: PracticeSession[];
  onOpen: (session: PracticeSession) => void;
  variant?: "recent" | "full";
}) {
  const visibleSessions = variant === "full" ? sessions : sessions.slice(0, 3);

  return (
    <section className="mt-10 pb-10">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-black tracking-[-0.05em]">{variant === "full" ? "전체 연습 기록" : "최근 연습"}</h2>
        {variant === "recent" && sessions.length > 0 ? <a href="/practice/history" className="text-base font-black text-[#2f6bff] transition hover:text-[#1b64da]">전체 보기</a> : null}
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
          <a href="/practice/new" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da]">첫 연습 시작하기</a>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSessions.map((session) => <PracticeHistoryCard key={session.id} session={session} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

function PracticeHistoryCard({ session, onOpen }: { session: PracticeSession; onOpen: (session: PracticeSession) => void }) {
  const content = (
    <>
      <div className="relative flex aspect-[2.78/1] items-center justify-center bg-[#1f2937]" style={{ backgroundImage: "repeating-linear-gradient(45deg, #202938 0 22px, #182131 22px 44px)" }}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-[#191f28] shadow-sm"><PlayIcon /></span>
        <span className="absolute bottom-3 right-3 rounded-lg bg-[#0f1724]/90 px-2.5 py-1 text-sm font-black text-white">{formatDuration(session.take.durationMs)}</span>
      </div>
      <div className="px-5 py-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black tracking-[-0.04em]">{formatPracticeTitle(session)}</h3>
            <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-[#8b95a1]">{formatPracticeSummary(session)}</p>
          </div>
          <span className={"shrink-0 rounded-full px-3 py-1.5 text-xs font-black " + (getPracticeBadge(session).positive ? "bg-[#e5f8ef] text-[#009959]" : "bg-[#f2f4f6] text-[#4e5968]")}>{getPracticeBadge(session).label}</span>
        </div>
        <p className="mt-4 text-sm font-bold text-[#b0b8c1]">{formatRelativePracticeDate(session.updatedAt)}</p>
      </div>
    </>
  );

  const className = "overflow-hidden rounded-[20px] border border-[#e5e8eb] bg-white shadow-[0_8px_24px_rgba(25,31,40,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(25,31,40,0.08)]";
  if (session.legacy) return <article className={className}>{content}</article>;
  return <button type="button" className={className} onClick={() => onOpen(session)}>{content}</button>;
}

function AppLogoMark() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6bff] text-white shadow-[0_8px_20px_rgba(49,130,246,0.2)]">
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-4 border-white"><span className="h-1.5 w-1.5 rounded-full bg-white" /></span>
    </span>
  );
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

function formatDisplayName(session: AuthSessionResponse): string {
  const email = session.user?.email;
  if (!email) return "배우";
  return email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "배우";
}

function formatPracticeTitle(session: PracticeSession): string {
  if (session.legacy) return session.genre || session.situation || "이전 버전 연습";
  return session.situation || "연기 연습";
}

function formatPracticeSummary(session: PracticeSession): string {
  if (session.legacy) return session.situation || "이전 버전 연습 기록";
  const actorTurn = [...session.turns].reverse().find((turn) => turn.role === "actor" && turn.deliveryStatus === "completed");
  return session.report?.headline || actorTurn?.text || session.sceneSummary?.summary || session.situation || "장면을 분석하고 있어요";
}

function getPracticeBadge(session: PracticeSession): { label: string; positive: boolean } {
  if (session.legacy) return { label: "이전 기록", positive: false };
  if (session.status === "END") return { label: "완료", positive: true };
  if (session.status === "REPORT") return { label: "리포트 준비", positive: false };
  if (session.status === "INTERVIEW") return { label: "인터뷰", positive: false };
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

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return "--:--";
  const totalSeconds = Math.round(durationMs / 1000);
  return String(Math.floor(totalSeconds / 60)) + ":" + String(totalSeconds % 60).padStart(2, "0");
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return String(Math.max(1, Math.round(sizeBytes / 1024))) + "KB";
  return (sizeBytes / (1024 * 1024)).toFixed(1) + "MB";
}

function SessionView({
  session,
  answer,
  pendingAnswer,
  setAnswer,
  busy,
  error,
  restartRequired,
  onStart,
  onRestart,
  onReply,
  onRetryReply,
  onRetryAnalysis,
  onReport,
}: {
  session: ActingCoachSessionDto;
  answer: string;
  pendingAnswer: string | null;
  setAnswer: (value: string) => void;
  busy: boolean;
  error: string | null;
  restartRequired: boolean;
  onStart: () => void;
  onRestart: () => void;
  onReply: () => void;
  onRetryReply: (actorTurnId: string) => void;
  onRetryAnalysis: () => void;
  onReport: () => void;
}) {
  const currentQuestion = [...session.turns].reverse().find((turn) => turn.role === "ai" && turn.deliveryStatus === "completed");
  const retryableActorTurn = [...session.turns].reverse().find((turn) => turn.role === "actor" && turn.deliveryStatus === "failed" && turn.deliveryRetryable);
  const restart = restartRequired || session.currentRun?.recoveryAction === "restart";
  const startRetry = session.currentRun?.status === "start_failed" && session.currentRun.failureRetryable && session.currentRun.recoveryAction === "start";
  const startTerminal = session.currentRun?.status === "start_failed" && !session.currentRun.failureRetryable;
  const analysisStatus = session.take.analysisStatus;

  return (
    <main className="min-h-dvh bg-[#f8fafc] px-4 py-6 text-[#191f28] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <AppLogoMark />
              <div>
                <p className="text-base font-black tracking-[-0.03em] text-[#2f6bff] sm:text-lg">
                  Acttub AI 연기 코치
                </p>
              </div>
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">
              {session.situation}
            </h1>
          </div>
          <nav aria-label="연습 화면 이동" className="flex gap-2">
            <a href="/home" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d1d6db] bg-white px-4 text-sm font-black text-[#4e5968] transition hover:border-[#3182f6] hover:text-[#1b64da]">
              홈
            </a>
          </nav>
        </header>

        {session.status === "ANALYZING" ? (
          <section aria-live="polite" className="mt-8 overflow-hidden rounded-[28px] border border-[#dce9ff] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
            <div className="bg-[#f7faff] p-6 sm:p-8">
              <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">
                영상 분석
              </span>
              <h2 className="mt-4 text-2xl font-black tracking-[-0.04em] sm:text-3xl">
                장면을 분석하고 있어요
              </h2>
              <p className="mt-3 max-w-2xl text-base font-bold leading-7 text-[#6b7684]">
                영상 속 행동과 장면 정보를 안전하게 정리하는 중이에요.
              </p>
              {analysisStatus !== "failed" && analysisStatus !== "outcome_unknown" ? (
                <div className="mt-7 h-3 overflow-hidden rounded-full bg-[#dce9ff]">
                  <div className="h-full w-3/4 rounded-full bg-[#3182f6]" />
                </div>
              ) : null}
              {analysisStatus === "failed" && session.take.analysisRetryable ? (
                <div className="mt-6 rounded-2xl border border-[#ffd8a8] bg-[#fff8ec] p-5">
                  <p className="font-bold leading-7 text-[#8a4b00]">분석을 완료하지 못했지만 같은 영상으로 다시 시도할 수 있어요.</p>
                  <button type="button" disabled={busy} onClick={onRetryAnalysis} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]">
                    {busy ? "다시 분석하는 중…" : "분석 다시 시도"}
                  </button>
                </div>
              ) : null}
              {analysisStatus === "failed" && !session.take.analysisRetryable ? (
                <p className="mt-6 rounded-2xl bg-red-50 p-5 font-bold leading-7 text-red-700">
                  이 영상의 분석은 안전하게 다시 시도할 수 없어요. 새 연습 세션을 시작해 주세요.
                </p>
              ) : null}
              {analysisStatus === "outcome_unknown" ? (
                <p className="mt-6 rounded-2xl bg-red-50 p-5 font-bold leading-7 text-red-700">
                  처리 결과를 확인할 수 없어 이 세션은 안전하게 재시도할 수 없어요. 새 연습을 시작해 주세요.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {session.status === "INTERVIEW" ? (
          <section className="mt-8 grid gap-5">
            {!session.currentRun && !restart ? (
              <div aria-live="polite" className="rounded-[28px] border border-[#dce9ff] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
                <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">AI 인터뷰</span>
                <h2 className="mt-4 text-2xl font-black tracking-[-0.04em]">AI 코치가 첫 질문을 준비하고 있어요</h2>
                <p className="mt-3 font-bold leading-7 text-[#6b7684]">영상 분석이 끝나 인터뷰 화면으로 바로 이동했어요.</p>
                {!busy && error ? (
                  <button type="button" className="mt-6 min-h-13 w-full rounded-2xl bg-[#2f6bff] px-5 py-3 font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da] sm:w-auto" onClick={onStart}>
                    인터뷰 준비 다시 시도
                  </button>
                ) : null}
              </div>
            ) : null}

            {startRetry && !restart ? (
              <div className="rounded-[24px] border border-[#ffd8a8] bg-[#fff8ec] p-5 sm:p-6">
                <h2 className="text-lg font-black text-[#8a4b00]">인터뷰 시작을 다시 확인해 주세요</h2>
                <p className="mt-2 font-bold leading-7 text-[#8a4b00]">인터뷰 시작 요청이 완료되지 않았어요. 같은 장면으로 다시 시작할 수 있어요.</p>
                <button type="button" className="mt-4 rounded-2xl bg-[#9a5b00] px-5 py-3 text-sm font-black text-white transition hover:bg-[#7a4800] disabled:opacity-50" disabled={busy} onClick={onStart}>
                  {busy ? "다시 시도하는 중…" : "인터뷰 시작 다시 시도"}
                </button>
              </div>
            ) : null}

            {startTerminal && !restart ? (
              <div className="rounded-[24px] border border-red-100 bg-red-50 p-5 text-red-800 sm:p-6">
                <h2 className="text-lg font-black">새 연습이 필요해요</h2>
                <p className="mt-2 font-bold leading-7">이 인터뷰는 안전하게 다시 시작할 수 없어요. 새 연습 세션을 시작해 주세요.</p>
              </div>
            ) : null}

            {restart ? (
              <div className="rounded-[24px] border border-[#ffd8a8] bg-[#fff8ec] p-5 sm:p-6">
                <h2 className="text-lg font-black text-[#8a4b00]">영상 분석은 안전하게 보관되어 있어요</h2>
                <p className="mt-2 font-bold leading-7 text-[#8a4b00]">이전 인터뷰 연결이 끝났어요. 영상 분석은 유지한 채 새 인터뷰를 시작할 수 있어요.</p>
                <button type="button" className="mt-4 rounded-2xl bg-[#9a5b00] px-5 py-3 text-sm font-black text-white transition hover:bg-[#7a4800] disabled:opacity-50" disabled={busy} onClick={onRestart}>
                  {busy ? "다시 시작하는 중…" : "인터뷰 다시 시작"}
                </button>
              </div>
            ) : null}

            {currentQuestion && !restart && !startRetry ? (
              <div className="overflow-hidden rounded-[28px] border border-[#e5e8eb] bg-white shadow-[0_14px_40px_rgba(25,31,40,0.06)]">
                <header className="flex items-center gap-3 border-b border-[#e5e8eb] px-5 py-4 sm:px-6">
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-xs font-black text-white">AI</span>
                  <div>
                    <h2 className="font-black tracking-[-0.03em]">AI 연기 코치</h2>
                    <p className="mt-0.5 text-xs font-bold text-[#8b95a1]">현재 장면을 바탕으로 질문하고 있어요</p>
                  </div>
                </header>

                <article className="border-b border-[#e5e8eb] bg-[#f7faff] px-5 py-5 sm:px-6">
                  <p className="text-xs font-black text-[#2f6bff]">현재 질문</p>
                  <p className="mt-2 text-lg font-black leading-8 tracking-[-0.025em]">{currentQuestion.text}</p>
                </article>

                <div role="log" aria-live="polite" aria-label="AI 코치와 나눈 대화" className="min-h-[280px] max-h-[520px] space-y-4 overflow-y-auto bg-[#f7f8fa] px-4 py-5 sm:px-6">
                  {session.turns.map((turn) => {
                    const isActorTurn = turn.role === "actor";
                    return (
                      <div key={turn.id} className={"flex items-end gap-2 " + (isActorTurn ? "justify-end" : "justify-start")}>
                        {!isActorTurn ? <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span> : null}
                        <div className={"max-w-[82%] rounded-2xl px-4 py-3 shadow-sm " + (isActorTurn ? "rounded-br-md bg-[#3182f6] text-white" : "rounded-bl-md border border-[#e5e8eb] bg-white text-[#191f28]")}>
                          <p className="text-xs font-black opacity-70">{isActorTurn ? "나" : "AI 코치"}</p>
                          <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">{turn.text}</p>
                        </div>
                      </div>
                    );
                  })}
                  {pendingAnswer ? (
                    <div data-message-id="pending-answer" className="flex items-end justify-end gap-2">
                      <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[#3182f6] px-4 py-3 text-white shadow-sm">
                        <p className="text-xs font-black opacity-70">나</p>
                        <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-6">{pendingAnswer}</p>
                      </div>
                    </div>
                  ) : null}
                  {busy ? (
                    <div className="flex items-end gap-2">
                      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f6bff] text-[10px] font-black text-white">AI</span>
                      <p className="rounded-2xl rounded-bl-md border border-[#e5e8eb] bg-white px-4 py-3 text-sm font-bold text-[#8b95a1] shadow-sm">답변을 확인하고 있어요…</p>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-[#e5e8eb] bg-white p-4 sm:p-5">
                  {retryableActorTurn ? (
                    <div className="rounded-2xl border border-[#ffd8a8] bg-[#fff8ec] p-4">
                      <p className="text-sm font-bold leading-6 text-[#8a4b00]">마지막 답변이 전달되지 않았어요. 같은 답변을 안전하게 다시 보낼 수 있어요.</p>
                      <button type="button" className="mt-3 min-h-11 rounded-xl bg-[#9a5b00] px-4 text-sm font-black text-white transition hover:bg-[#7a4800] disabled:opacity-50" disabled={busy} onClick={() => onRetryReply(retryableActorTurn.id)}>
                        {busy ? "다시 보내는 중…" : "마지막 답변 다시 보내기"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <textarea
                        aria-label="답변"
                        rows={3}
                        className="min-h-24 flex-1 resize-y rounded-2xl border border-[#d1d6db] bg-white p-4 text-[15px] font-semibold leading-6 outline-none transition placeholder:text-[#b0b8c1] focus:border-[#3182f6] focus:ring-4 focus:ring-[#e8f3ff] disabled:bg-[#f2f4f6]"
                        value={answer}
                        maxLength={PRACTICE_INPUT_LIMITS.replyCodePoints * 2}
                        disabled={busy}
                        placeholder="질문을 듣고 떠오른 생각을 편하게 적어 주세요."
                        onChange={(event) => {
                          if (countUnicodeCodePoints(event.target.value) <= PRACTICE_INPUT_LIMITS.replyCodePoints) {
                            setAnswer(event.target.value);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing &&
                            answer.trim()
                          ) {
                            event.preventDefault();
                            onReply();
                          }
                        }}
                      />
                      <span className="text-right text-xs font-bold text-[#8b95a1] sm:self-center">
                        {countUnicodeCodePoints(answer).toLocaleString()} / {PRACTICE_INPUT_LIMITS.replyCodePoints.toLocaleString()}
                      </span>
                      <button type="button" className="min-h-12 shrink-0 rounded-2xl bg-[#2f6bff] px-6 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff]" disabled={busy || !answer.trim()} onClick={onReply}>
                        {busy ? "보내는 중…" : "답변 보내기"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {session.status === "REPORT" ? (
          <section className="mt-8 rounded-[28px] border border-[#dce9ff] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
            <span className="inline-flex rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#2f6bff]">인터뷰 완료</span>
            <h2 className="mt-4 text-2xl font-black tracking-[-0.04em] sm:text-3xl">인터뷰가 완료됐어요</h2>
            <p className="mt-3 max-w-2xl font-bold leading-7 text-[#6b7684]">대화를 바탕으로 연기 리포트를 만들 수 있어요.</p>
            <button type="button" className="mt-6 min-h-13 w-full rounded-2xl bg-[#2f6bff] px-6 py-3 font-black text-white shadow-[0_10px_20px_rgba(49,130,246,0.18)] transition hover:bg-[#1b64da] disabled:bg-[#b0d2ff] sm:w-auto" disabled={busy} onClick={onReport}>
              {busy ? "리포트를 만드는 중…" : "리포트 만들기"}
            </button>
          </section>
        ) : null}

        {session.status === "END" ? <Report report={session.report} /> : null}
        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </main>
  );
}

function Report({ report }: { report?: ActingReportDto | null }) {
  if (!report) {
    return (
      <section className="mt-8 rounded-[28px] border border-[#e5e8eb] bg-white p-6 shadow-[0_14px_40px_rgba(25,31,40,0.06)] sm:p-8">
        <p className="text-sm font-black text-[#2f6bff]">연기 리포트</p>
        <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">저장된 리포트를 불러오는 중이에요.</h2>
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-4">
      <header className="rounded-[28px] bg-[#2f6bff] p-6 text-white shadow-[0_16px_36px_rgba(49,130,246,0.2)] sm:p-8">
        <p className="text-sm font-black text-white/75">{report.reportCount}번째 연기 리포트</p>
        <h2 className="mt-3 text-3xl font-black leading-tight tracking-[-0.05em] sm:text-4xl">{report.headline}</h2>
      </header>
      <article className="rounded-[24px] border border-[#dce9ff] bg-[#f7faff] p-5 sm:p-6">
        <p className="text-xs font-black text-[#2f6bff]">핵심 피드백</p>
        <h3 className="mt-2 text-xl font-black tracking-[-0.035em]">가장 크게 보완할 지점</h3>
        <p className="mt-3 inline-flex rounded-full bg-white px-3 py-1.5 text-sm font-black text-[#4e5968]">
          {report.biggestProblem.start}–{report.biggestProblem.end} · {report.biggestProblem.dimension}
        </p>
        <p className="mt-4 whitespace-pre-wrap font-semibold leading-7 text-[#333d4b]">{report.biggestProblem.description}</p>
      </article>
      <div className="grid gap-4 md:grid-cols-2">
        <ReportSection title="장면에서 찾은 근거" body={report.evidence} />
        <ReportSection title="스스로 발견한 점" body={report.selfDiscovery} />
        <ReportSection title="잘하고 있는 점" body={report.encouragement} tone="positive" />
        <ReportSection title="다음 연습" body={report.nextStep} tone="action" />
        {report.comparison?.trim() ? <ReportSection title="이전 연습과 비교" body={report.comparison} wide /> : null}
      </div>
      <aside className="rounded-[24px] border border-[#dce9ff] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.035)] sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div>
          <h3 className="text-lg font-black tracking-[-0.035em]">이번 연습은 어떠셨나요?</h3>
          <p className="mt-2 font-semibold leading-7 text-[#4e5968]">짧은 설문으로 경험을 알려 주시면 더 나은 연기 코치를 만드는 데 활용할게요.</p>
        </div>
        <a
          href="https://acttub.github.io/review-form/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="세션 후기 설문조사 참여하기 (새 창)"
          className="mt-5 inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl bg-[#2f6bff] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1b64da] sm:mt-0"
        >
          설문조사 참여하기 ↗
        </a>
      </aside>
    </section>
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
      <h3 className="text-lg font-black tracking-[-0.035em]">{title}</h3>
      <p className="mt-3 whitespace-pre-wrap font-semibold leading-7 text-[#4e5968]">{body}</p>
    </article>
  );
}
