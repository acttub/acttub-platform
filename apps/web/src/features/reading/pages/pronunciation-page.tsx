"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page } from "@/features/reading/page-shell";
import {
  PRON_COPY,
  PronunciationNotice,
  PronunciationReportBody,
  PronunciationSkeleton,
  type ReportLineView,
} from "@/features/reading/screens/PronunciationReportScreen";
import { ApiError } from "@/lib/api/v2/errors";
import { getPronunciationReport } from "@/lib/api/v2/reading-pronunciation";
import { getScript } from "@/lib/api/v2/reading-scripts";
import { getSession } from "@/lib/api/v2/reading-sessions";
import type { ScriptDetail, SessionRecording } from "@/lib/reading/api-types";
import {
  PRONUNCIATION_NOT_AVAILABLE,
  latestByLine,
  lineIdOf,
  markWindow,
  pronunciationSettled,
  type PronunciationMark,
  type PronunciationState,
} from "@/lib/reading/pronunciation-report";
import { playbackUrl } from "@/lib/reading/recording/playback";

/** 분석이 끝날 때까지 다시 묻는 간격과 최대 횟수(약 3분). 앱과 같다. */
const POLL_MS = 4_000;
const POLL_MAX = 45;

type Load = "loading" | "notReady" | "failed" | "ready";

/**
 * /reading/pronunciation?session=<회차 id> — 발음 보고서(SOMA-606). 앱이 앱 안 웹 화면으로 띄우므로 `app=1` 이면 사이트 상단
 * 네비를 숨긴다(앱이 뒤로가기·제목 줄을 그린다). 출시 뒤에도 이 페이지만 배포하면 보고서 화면이 바뀐다.
 */
export function PronunciationPage() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const inApp = params.get("app") === "1";
  const [load, setLoad] = useState<Load>(sessionId ? "loading" : "failed");
  const [state, setState] = useState<PronunciationState | null>(null);
  const [recordings, setRecordings] = useState<SessionRecording[]>([]);
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  const loadRecordings = useCallback(
    async (signal?: AbortSignal): Promise<SessionRecording[]> => {
      if (!sessionId) return [];
      const detail = await getSession(sessionId, { signal }).catch(() => null);
      if (!detail) return [];
      setRecordings(detail.recordings);
      return detail.recordings;
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const poll = async () => {
      try {
        const next = await getPronunciationReport(sessionId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState(next);
        setLoad("ready");
        tries += 1;
        if (!pronunciationSettled(next.status) && tries < POLL_MAX) timer = setTimeout(() => void poll(), POLL_MS);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoad(cause instanceof ApiError && cause.code === PRONUNCIATION_NOT_AVAILABLE ? "notReady" : "failed");
      }
    };
    void poll();
    void (async () => {
      const detail = await getSession(sessionId, { signal: controller.signal }).catch(() => null);
      if (!detail || controller.signal.aborted) return;
      setRecordings(detail.recordings);
      const found = await getScript(detail.script_id, { signal: controller.signal }).catch(() => null);
      if (found && !controller.signal.aborted) setScript(found);
    })();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const latest = useMemo(() => latestByLine(recordings), [recordings]);
  const lineIds = useMemo(() => {
    const out = new Map<number, string>();
    for (const line of state?.report?.lines ?? []) {
      const id = script ? lineIdOf(script.lines, line) : null;
      if (id) out.set(line.lineNo, id);
    }
    return out;
  }, [script, state]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    stopAt.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(
    async (key: string, lineNo: number, mark?: PronunciationMark) => {
      if (playing === key) {
        stop();
        return;
      }
      const lineId = lineIds.get(lineNo);
      if (!lineId) return;
      let rec = latest.get(lineId) ?? null;
      let url = rec ? playbackUrl(rec) : null;
      if (!url) {
        // 재생 주소는 10분 서명이라 만료됐으면 회차를 다시 받아 새 주소로 튼다.
        rec = latestByLine(await loadRecordings()).get(lineId) ?? null;
        url = rec ? playbackUrl(rec) : null;
      }
      if (!url) return;
      stop();
      if (!audioRef.current) {
        const audio = new Audio();
        audio.addEventListener("ended", () => setPlaying(null));
        audio.addEventListener("timeupdate", () => {
          if (stopAt.current != null && audio.currentTime >= stopAt.current) {
            audio.pause();
            stopAt.current = null;
            setPlaying(null);
          }
        });
        audioRef.current = audio;
      }
      const audio = audioRef.current;
      audio.src = url;
      const range = mark ? markWindow(mark) : null;
      stopAt.current = range?.to ?? null;
      if (range) audio.currentTime = range.from;
      setPlaying(key);
      await audio.play().catch(() => setPlaying(null));
    },
    [latest, lineIds, loadRecordings, playing, stop],
  );

  const lines: ReportLineView[] = (state?.report?.lines ?? []).map((line) => {
    const id = lineIds.get(line.lineNo);
    return { ...line, canPlay: !!id && !!latest.get(id)?.playback_url };
  });

  let body;
  if (load === "loading") body = <PronunciationSkeleton />;
  else if (load === "notReady") body = <PronunciationNotice>{PRON_COPY.notReady}</PronunciationNotice>;
  else if (load === "failed" || !state) body = <PronunciationNotice>{PRON_COPY.failed}</PronunciationNotice>;
  else if (!pronunciationSettled(state.status)) body = <PronunciationNotice>{PRON_COPY.waiting}</PronunciationNotice>;
  else if (state.status !== "done" || !state.report)
    body = <PronunciationNotice>{state.status === "skipped" ? PRON_COPY.skipped : PRON_COPY.failed}</PronunciationNotice>;
  else body = <PronunciationReportBody report={state.report} lines={lines} playing={playing} onPlay={(k, n, m) => void play(k, n, m)} />;

  if (inApp) return <main className="min-h-svh bg-white flex flex-col">{body}</main>;
  return (
    <Page>
      <div className="bg-white flex-1 flex flex-col md:rounded-[18px] md:max-w-[640px]">{body}</div>
    </Page>
  );
}
