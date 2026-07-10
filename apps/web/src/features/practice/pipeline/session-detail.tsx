"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPipelinePracticeSession, retryPipelineReport } from "@/lib/api/practice";
import type { PipelineSessionAggregateDto } from "@/lib/api/types";
import { PrivateVideo, type PrivateVideoHandle } from "./private-video";
import { ReportView } from "./report-view";

export function PipelineSessionDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<PipelineSessionAggregateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const videoRef = useRef<PrivateVideoHandle>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setSession((await getPipelinePracticeSession(sessionId)).session); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "연습 기록을 불러오지 못했어요."); }
    finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    getPipelinePracticeSession(sessionId).then(
      ({ session: persistedSession }) => { if (active) setSession(persistedSession); },
      (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "연습 기록을 불러오지 못했어요."); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const latestReportRun = session?.runs.filter((run) => run.stage === "report").at(-1);
  const retryableReportFailure = session?.report === null
    && latestReportRun?.status === "failed"
    && latestReportRun.retryable;

  async function retryReport() {
    setRetrying(true);
    setError(null);
    try { await retryPipelineReport(sessionId); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "리포트를 다시 만들지 못했어요."); }
    finally { setRetrying(false); }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 md:py-12">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div><Link href="/practice/history" className="text-sm text-slate-500">← 연습 기록</Link><h1 className="mt-2 text-3xl font-bold">연습 상세</h1></div>
        <button type="button" onClick={() => void reload()} disabled={loading} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-50">새로고침</button>
      </header>
      {error ? <p role="alert" className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      {loading && !session ? <p className="py-20 text-center text-slate-500">저장된 연습 기록을 불러오고 있어요.</p> : null}
      {session ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4"><PrivateVideo ref={videoRef} sessionId={sessionId} />
            <section className="rounded-2xl bg-white p-5"><h2 className="font-semibold">진행 상태</h2><p className="mt-2 text-sm text-slate-600">{session.interviewStatus === "paused" ? "인터뷰가 일시 정지되었어요." : session.interviewStatus === "completed_without_report" ? "인터뷰는 끝났지만 확인된 근거가 충분하지 않아 리포트가 없어요." : session.report ? "리포트가 완료되었어요." : "리포트를 준비하고 있어요."}</p>
              {retryableReportFailure ? <button type="button" onClick={() => void retryReport()} disabled={retrying} className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{retrying ? "다시 만드는 중" : "리포트 다시 만들기"}</button> : null}
            </section>
          </div>
          {session.report ? <ReportView report={session.report} onSeek={(startMs) => videoRef.current?.seekTo(startMs)} /> : <section className="rounded-3xl bg-white p-8"><h2 className="text-xl font-bold">리포트가 아직 없어요</h2><p className="mt-3 text-slate-600">진행 상태를 확인한 뒤 새로고침해 주세요.</p></section>}
        </div>
      ) : null}
    </main>
  );
}
