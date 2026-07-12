"use client";

import { useEffect, useRef, useState } from "react";
import { getAuthSession } from "@/lib/api/auth";
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
  type SceneGenre,
  type SceneMedium,
} from "@/lib/api/sessions";
import type { ActingCoachSessionDto, ActingReportDto } from "@/lib/api/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_UPLOAD_BYTES = 576_716_800;
const MAX_DURATION_MS = 180_000;
const media: SceneMedium[] = ["연극", "영화", "TV 드라마", "웹드라마", "뮤지컬", "기타"];
const genres: SceneGenre[] = ["드라마", "코미디", "로맨스", "스릴러", "액션", "판타지", "기타"];
type Entry = "home" | "new" | "history";

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
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const [active, setActive] = useState<ActingCoachSessionDto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [medium, setMedium] = useState<SceneMedium | null>(null);
  const [genre, setGenre] = useState<SceneGenre | null>(null);
  const [situation, setSituation] = useState("");
  const [characterContext, setCharacterContext] = useState("");
  const [subtext, setSubtext] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    getAuthSession().then((auth) => {
      if (!auth.authenticated) return void (location.href = `/auth/login?next=/practice/${entry === "history" ? "history" : "new"}`);
      if (!auth.terms.accepted) return void (location.href = "/terms");
      return listPracticeSessions().then(({ sessions }) => {
        if (mounted) { setHistory(sessions); setReady(true); }
      });
    }).catch((reason) => setError(errorMessage(reason)));
    return () => { mounted = false; };
  }, [entry]);

  async function begin() {
    if (!file || !medium || !genre || !situation.trim() || !characterContext.trim() || !subtext.trim()) {
      setError("영상, 매체, 장르, 상황, 인물 정보와 서브텍스트를 모두 입력해 주세요."); return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) { setError("영상은 550MB 이하여야 해요."); return; }
    if (file.type !== "video/mp4" && file.type !== "video/quicktime") { setError("MP4 또는 MOV 영상만 업로드할 수 있어요."); return; }
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
        medium, genre, situation: situation.trim(), characterContext: characterContext.trim(), subtext: subtext.trim(),
      });
      setActive(session); setHistory((items) => [session, ...items.filter((item) => item.id !== session.id)]);
    } catch (reason) {
      if (persistedSessionId) await recoverPersistedSession(persistedSessionId, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function operation(kind: "start" | "restart") {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const session = await mutatePracticeTurn(active.id, { operation: kind, requestId: crypto.randomUUID() });
      setActive(session); setRestartRequired(false);
    } catch (reason) {
      await recoverPersistedSession(active.id, reason);
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  async function reply() {
    const text = answer.trim();
    if (!active?.currentRun || !text) return;
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
    } finally { setBusy(false); }
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
    try { setActive(await retryPracticeAnalysis(active.id)); }
    catch (reason) {
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

  if (!ready) return <main className="mx-auto max-w-3xl p-8">{error ?? "연습 공간을 준비하는 중이에요."}</main>;
  if (entry === "history" && !active) return <History sessions={history} onOpen={(session) => !session.legacy && setActive(session)} />;
  if (active) return <SessionView session={active} answer={answer} setAnswer={setAnswer} busy={busy} error={error} restartRequired={restartRequired} onStart={() => operation("start")} onRestart={() => operation("restart")} onReply={reply} onRetryReply={retryReply} onRetryAnalysis={retryAnalysis} onReport={report} />;

  return <main className="mx-auto grid max-w-3xl gap-6 p-6 md:p-10">
    <header><p className="text-sm font-semibold text-violet-600">새 연기 연습</p><h1 className="text-3xl font-bold">장면을 올리고 인터뷰를 시작하세요</h1></header>
    <label className="rounded-2xl border border-dashed p-6"><span className="font-semibold">연기 영상 (MP4/MOV, 최대 550MB, 3분)</span><input ref={inputRef} className="mt-3 block" type="file" accept="video/mp4,video/quicktime" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{file && <span className="mt-2 block text-sm">{file.name}</span>}</label>
    <ChipField label="매체" options={media} value={medium} onChange={setMedium} />
    <ChipField label="장르" options={genres} value={genre} onChange={setGenre} />
    <TextField label="상황" value={situation} onChange={setSituation} />
    <TextField label="인물 정보" value={characterContext} onChange={setCharacterContext} />
    <TextField label="서브텍스트" value={subtext} onChange={setSubtext} />
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    <button className="rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={begin}>{busy ? "업로드하고 분석하는 중…" : "분석 시작"}</button>
  </main>;
}

function ChipField<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T | null; onChange: (value: T) => void }) {
  return <fieldset><legend className="mb-2 font-semibold">{label} (필수)</legend><div className="flex flex-wrap gap-2">{options.map((option) => <button type="button" key={option} aria-pressed={value === option} onClick={() => onChange(option)} className={`rounded-full border px-4 py-2 ${value === option ? "bg-violet-600 text-white" : "bg-white"}`}>{option}</button>)}</div></fieldset>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 font-semibold">{label} (필수)<textarea className="min-h-24 rounded-xl border p-3 font-normal" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function SessionView({ session, answer, setAnswer, busy, error, restartRequired, onStart, onRestart, onReply, onRetryReply, onRetryAnalysis, onReport }: { session: ActingCoachSessionDto; answer: string; setAnswer: (value: string) => void; busy: boolean; error: string | null; restartRequired: boolean; onStart: () => void; onRestart: () => void; onReply: () => void; onRetryReply: (actorTurnId: string) => void; onRetryAnalysis: () => void; onReport: () => void }) {
  const currentQuestion = [...session.turns].reverse().find((turn) => turn.role === "ai" && turn.deliveryStatus === "completed");
  const retryableActorTurn = [...session.turns].reverse().find((turn) => turn.role === "actor" && turn.deliveryStatus === "failed" && turn.deliveryRetryable);
  const restart = restartRequired || session.currentRun?.recoveryAction === "restart";
  const startRetry = session.currentRun?.status === "start_failed" && session.currentRun.failureRetryable && session.currentRun.recoveryAction === "start";
  const startTerminal = session.currentRun?.status === "start_failed" && !session.currentRun.failureRetryable;
  const analysisStatus = session.take.analysisStatus;
  return <main className="mx-auto grid max-w-3xl gap-5 p-6 md:p-10">
    <header><p className="text-sm font-semibold text-violet-600">{session.medium} · {session.genre}</p><h1 className="text-2xl font-bold">{session.situation}</h1></header>
    {session.status === "ANALYZING" && <section className="rounded-2xl bg-violet-50 p-6"><h2 className="text-xl font-bold">장면을 분석하고 있어요</h2><p className="mt-2">영상 속 행동과 장면 정보를 안전하게 정리하는 중이에요.</p>{analysisStatus === "failed" && session.take.analysisRetryable && <button onClick={onRetryAnalysis}>분석 다시 시도</button>}{analysisStatus === "failed" && !session.take.analysisRetryable && <p className="mt-3 text-red-700">이 영상의 분석은 안전하게 다시 시도할 수 없어요. 새 연습 세션을 시작해 주세요.</p>}{analysisStatus === "outcome_unknown" && <p className="mt-3 text-red-700">처리 결과를 확인할 수 없어 이 세션은 안전하게 재시도할 수 없어요. 새 연습을 시작해 주세요.</p>}</section>}
    {session.status === "INTERVIEW" && <section className="grid gap-4">
      {!session.currentRun && !restart && <button className="rounded-xl bg-violet-600 p-3 text-white" disabled={busy} onClick={onStart}>인터뷰 시작</button>}
      {startRetry && !restart && <div className="rounded-2xl bg-amber-50 p-5"><p>인터뷰 시작 요청이 완료되지 않았어요. 같은 장면으로 다시 시작할 수 있어요.</p><button className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-white" disabled={busy} onClick={onStart}>인터뷰 시작 다시 시도</button></div>}
      {startTerminal && !restart && <div className="rounded-2xl bg-red-50 p-5 text-red-800"><p>이 인터뷰는 안전하게 다시 시작할 수 없어요. 새 연습 세션을 시작해 주세요.</p></div>}
      {restart && <div className="rounded-2xl bg-amber-50 p-5"><p>이전 인터뷰 연결이 끝났어요. 영상 분석은 유지한 채 새 인터뷰를 시작할 수 있어요.</p><button className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-white" disabled={busy} onClick={onRestart}>인터뷰 다시 시작</button></div>}
      {currentQuestion && !restart && !startRetry && <><article className="rounded-2xl bg-violet-50 p-5"><p className="text-sm font-semibold">현재 질문</p><p className="mt-2 text-lg">{currentQuestion.text}</p></article><div role="log" aria-live="polite" aria-label="AI 코치와 나눈 대화" className="max-h-72 space-y-2 overflow-auto">{session.turns.map((turn) => <p key={turn.id} className={turn.role === "actor" ? "text-right" : "text-left"}><span className="inline-block rounded-xl bg-gray-100 px-4 py-2">{turn.text}</span></p>)}</div>{retryableActorTurn ? <button className="rounded-xl border border-amber-700 p-3 text-amber-800 disabled:opacity-50" disabled={busy} onClick={() => onRetryReply(retryableActorTurn.id)}>마지막 답변 다시 보내기</button> : <><textarea aria-label="답변" className="rounded-xl border p-3" value={answer} disabled={busy} onChange={(e) => setAnswer(e.target.value)} /><button className="rounded-xl bg-violet-600 p-3 text-white disabled:opacity-50" disabled={busy || !answer.trim()} onClick={onReply}>답변 보내기</button></>}</>}
    </section>}
    {session.status === "REPORT" && <section className="rounded-2xl bg-violet-50 p-6"><h2 className="text-xl font-bold">인터뷰가 완료됐어요</h2><p className="mt-2">대화를 바탕으로 연기 리포트를 만들 수 있어요.</p><button className="mt-4 rounded-xl bg-violet-600 px-5 py-3 text-white" disabled={busy} onClick={onReport}>리포트 만들기</button></section>}
    {session.status === "END" && <Report report={session.report} />}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
  </main>;
}

function Report({ report }: { report?: ActingReportDto | null }) {
  if (!report) return <section><h2 className="text-2xl font-bold">연기 리포트</h2><p>저장된 리포트를 불러오는 중이에요.</p></section>;
  return <section className="grid gap-4">
    <header><p className="text-sm font-semibold text-violet-600">{report.reportCount}번째 리포트</p><h2 className="text-2xl font-bold">{report.headline}</h2></header>
    <article className="rounded-2xl border p-5"><h3 className="font-semibold">가장 크게 보완할 지점</h3><p className="mt-2 text-sm text-gray-600">{report.biggestProblem.start}–{report.biggestProblem.end} · {report.biggestProblem.dimension}</p><p className="mt-2 whitespace-pre-wrap">{report.biggestProblem.description}</p></article>
    <ReportSection title="장면에서 찾은 근거" body={report.evidence} />
    <ReportSection title="스스로 발견한 점" body={report.selfDiscovery} />
    <ReportSection title="잘하고 있는 점" body={report.encouragement} />
    <ReportSection title="다음 연습" body={report.nextStep} />
    {report.comparison?.trim() ? <ReportSection title="이전 연습과 비교" body={report.comparison} /> : null}
  </section>;
}

function ReportSection({ title, body }: { title: string; body: string }) {
  return <article className="rounded-2xl border p-5"><h3 className="font-semibold">{title}</h3><p className="mt-2 whitespace-pre-wrap">{body}</p></article>;
}

function History({ sessions, onOpen }: { sessions: PracticeSession[]; onOpen: (session: PracticeSession) => void }) {
  const reports = sessions.filter((session) => !session.legacy && Boolean(session.report));
  return <main className="mx-auto max-w-3xl p-6 md:p-10"><h1 className="text-3xl font-bold">연기 리포트 기록</h1><div className="mt-6 grid gap-3">{reports.length === 0 && <p>아직 저장된 리포트가 없어요.</p>}{reports.map((session) => <button className="rounded-2xl border p-5 text-left" key={session.id} onClick={() => onOpen(session)}><strong>{session.genre}</strong><p>{session.situation}</p><small>{new Date(session.createdAt).toLocaleDateString("ko-KR")}</small></button>)}</div><section className="mt-10"><h2 className="font-semibold">이전 버전 연습</h2><p className="text-sm text-gray-600">이전 버전 기록은 읽기 전용이며 리포트 기록에는 포함되지 않아요.</p></section></main>;
}
