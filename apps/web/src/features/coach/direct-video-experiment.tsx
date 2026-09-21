"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteDirectVideo, getDirectVideo, sendDirectVideo, startDirectVideo,
  type DirectVideoSession,
} from "@/lib/api/v2/direct-video";
import { errorMessage } from "@/lib/api/v2/errors";

export function DirectVideoExperiment() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [session, setSession] = useState<DirectVideoSession | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDraft, setPendingDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const working = busy || session?.status === "preparing" || session?.status === "replying";

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!session || !["preparing", "replying"].includes(session.status)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const next = await getDirectVideo(session.id, controller.signal);
        setSession(next);
        if (next.error) {
          setError("답변을 받지 못했어요. 잠시 후 다시 시도해 주세요.");
        } else if (next.status === "ready" || next.status === "finished") {
          setDraft("");
          setPendingDraft("");
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(errorMessage(failure, "연결이 끊겼어요. 상태 확인을 다시 눌러 주세요."));
        }
      }
    }, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [session, pollRetry]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [session?.messages.length]);

  async function start() {
    if (!file) return;
    setError("");
    if (file.size === 0 || file.size > 50 * 1024 * 1024) {
      setError("50MB 이하의 영상 파일을 선택해 주세요.");
      return;
    }
    setBusy(true);
    try { setSession(await startDirectVideo(file)); }
    catch (failure) { setError(errorMessage(failure, "대화를 시작하지 못했어요.")); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!session || !draft.trim() || working) return;
    setError("");
    setBusy(true);
    setPendingDraft(draft);
    try {
      const next = await sendDirectVideo(session.id, draft.trim());
      setSession(next);
      if (["ready", "finished"].includes(next.status) && !next.error) { setDraft(""); setPendingDraft(""); }
    }
    catch (failure) { setError(errorMessage(failure, "메시지를 보내지 못했어요.")); setPendingDraft(""); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await deleteDirectVideo(session.id);
      setSession(null); setDraft(""); setPendingDraft("");
    } catch (failure) { setError(errorMessage(failure, "대화를 닫지 못했어요.")); }
    finally { setBusy(false); }
  }

  function download() {
    if (!session) return;
    const text = [`영상 직접 대화 테스트 · ${session.model}`, file?.name ?? "", "",
      ...session.messages.map(message => `${message.role === "user" ? "나" : "코치"}: ${message.text}\n`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "acttub-direct-video-chat.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 text-gray-900">
      <p className="mb-2 text-sm text-gray-500">ACTTUB · dev 실험</p>
      <h1 className="text-2xl font-bold">영상을 보며 바로 대화해요</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600">
        코치가 영상을 직접 보고 대화를 이어가요. 대화는 30분 동안만 유지되며,
        새로고침하면 화면에서 사라져요. 비교할 내용은 대화 저장으로 남겨 주세요.
      </p>
      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section>
          <label htmlFor="direct-video" className="mb-3 block font-semibold">연습 영상</label>
          {!session && <input id="direct-video" type="file" accept="video/mp4,video/quicktime,video/webm,video/mpeg"
            disabled={busy} className="w-full rounded-lg border border-gray-200 p-3 text-sm"
            onChange={event => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected); setPreview(selected ? URL.createObjectURL(selected) : ""); setError("");
            }} />}
          {preview && <video src={preview} controls playsInline className="mt-4 max-h-96 w-full rounded-xl bg-black" />}
          <p className="mt-3 text-xs text-gray-500">MP4 · MOV · WebM · MPEG, 최대 50MB</p>
          {!session && <button type="button" disabled={!file || busy} onClick={start}
            className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:bg-gray-200 disabled:text-gray-500">
            {busy ? "영상을 올리고 있어요…" : "질문 받기"}
          </button>}
          {session && <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={download} disabled={!session.messages.length}
              className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm disabled:opacity-40">대화 저장</button>
            <button type="button" onClick={reset} disabled={busy}
              className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm disabled:opacity-40">대화 닫기</button>
          </div>}
          {session && <p className="mt-4 text-xs text-gray-500">테스트 모델: {session.model}</p>}
        </section>
        <section aria-label="코치와 대화" className="min-w-0">
          {!session && <p className="py-8 text-gray-500">영상을 올리면 코치의 첫 질문이 여기에 나와요.</p>}
          <div aria-live="polite" className="space-y-6">
            {session?.messages.map((message, index) => <div key={index} className={message.role === "user" ? "ml-8 rounded-xl bg-gray-100 p-4" : "py-2"}>
              <p className="mb-2 text-xs text-gray-500">{message.role === "user" ? "나" : "코치"}</p>
              <p className="whitespace-pre-wrap break-words leading-7">{message.text}</p>
            </div>)}
            {working && <p className="text-sm text-gray-500">{session?.status === "replying" ? "영상과 대화를 살펴보고 있어요…" : "영상을 준비하고 첫 질문을 만들고 있어요…"}</p>}
            <div ref={end} />
          </div>
          {error && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            <p>{error}</p>
            {session && ["preparing", "replying"].includes(session.status) && <button type="button"
              className="mt-3 min-h-11 underline" onClick={() => { setError(""); setPollRetry(value => value + 1); }}>상태 다시 확인</button>}
          </div>}
          {session?.status === "finished" && <p className="mt-6 text-sm text-gray-500">대화를 마쳤어요. 대화를 저장한 뒤 닫아 주세요.</p>}
          {session && !["failed", "finished"].includes(session.status) && <form className="mt-8" onSubmit={event => { event.preventDefault(); void send(); }}>
            <label htmlFor="direct-message" className="mb-2 block text-sm font-medium">코치에게 답하기</label>
            <textarea id="direct-message" value={draft} maxLength={2000} disabled={working || session.messages.length >= 19}
              onChange={event => setDraft(event.target.value)} rows={3}
              className="w-full resize-y rounded-xl border border-gray-300 p-3 disabled:bg-gray-50" />
            {session.error && pendingDraft && <p className="mt-2 text-sm text-gray-500">보내려던 메시지를 유지했어요. 다시 보낼 수 있어요.</p>}
            <button type="submit" disabled={working || !draft.trim() || session.messages.length >= 19}
              className="mt-3 min-h-12 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:bg-gray-200 disabled:text-gray-500">보내기</button>
            {session.messages.length >= 19 && <p className="mt-3 text-sm text-gray-500">이번 테스트 대화를 마쳤어요. 대화를 저장한 뒤 닫아 주세요.</p>}
          </form>}
        </section>
      </div>
    </main>
  );
}
