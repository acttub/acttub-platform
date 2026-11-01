"use client";

/**
 * 회차 카드를 펼치면 보이는 줄 순서 녹음 목록(reading.recording) — 줄 원문·길이·재생·전사(있으면), "이어 듣기"(내 대사 녹음을
 * 순서대로), 개별 삭제. 재생 주소는 10분 서명이라 만료 뒤에는 목록을 다시 받는다.
 */
import { useEffect, useRef, useState } from "react";
import { deleteRecording } from "@/lib/api/v2/reading-recordings";
import { getSession } from "@/lib/api/v2/reading-sessions";
import { errorMessage } from "@/lib/api/v2/errors";
import type { SessionRecording } from "@/lib/reading/api-types";
import { durationLabel, playbackUrl, playlistOf, type PlaylistItem } from "@/lib/reading/recording/playback";
import type { StoredScript } from "@/lib/reading/storage";
import { Button } from "@/features/reading/ui";

const LOAD_FAILED_COPY = "녹음 목록을 불러오지 못했어요.";
const DELETE_FAILED_COPY = "녹음을 지우지 못했어요. 다시 시도해 주세요.";

export function SessionRecordings({ script, sessionId, onChanged }: { script: StoredScript; sessionId: string; onChanged: () => void }) {
  const [items, setItems] = useState<PlaylistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSession(sessionId, { signal: controller.signal }).then(
      (detail) => {
        if (controller.signal.aborted) return;
        setItems(playlistOf(script, detail.recordings));
        setError(null);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, LOAD_FAILED_COPY));
      },
    );
    return () => controller.abort();
  }, [script, sessionId, version]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  function audio(): HTMLAudioElement {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }

  /** 재생 주소가 만료됐으면 목록을 다시 받고 새 주소로 튼다. */
  async function play(list: PlaylistItem[], index: number) {
    const item = list[index];
    if (!item) {
      setPlaying(null);
      return;
    }
    let url = playbackUrl(item.recording);
    if (!url) {
      try {
        const fresh = playlistOf(script, (await getSession(sessionId)).recordings);
        setItems(fresh);
        const again = fresh.find((f) => f.recording.id === item.recording.id);
        url = again ? playbackUrl(again.recording) : null;
      } catch (cause) {
        setError(errorMessage(cause, LOAD_FAILED_COPY));
      }
      if (!url) {
        setPlaying(null);
        return;
      }
    }
    const el = audio();
    el.pause();
    el.src = url;
    el.onended = () => void play(list, index + 1);
    el.onerror = () => setPlaying(null);
    setPlaying(item.recording.id);
    try {
      await el.play();
    } catch {
      setPlaying(null);
    }
  }

  function stop() {
    audioRef.current?.pause();
    setPlaying(null);
  }

  async function remove(recording: SessionRecording) {
    setBusyId(recording.id);
    setError(null);
    try {
      await deleteRecording(recording.id);
      setVersion((v) => v + 1);
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, DELETE_FAILED_COPY));
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && !error) return <p className="text-[12px] text-ink-4">녹음을 불러오는 중…</p>;
  if (items === null) return <p className="text-[12px] text-red">{error}</p>;
  if (items.length === 0) return <p className="text-[12px] text-ink-4">이 회차에는 녹음이 없어요.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {playing ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            멈추기
          </Button>
        ) : (
          <Button size="sm" onClick={() => void play(items, 0)}>
            이어 듣기
          </Button>
        )}
        <span className="text-[11.5px] text-ink-4">내 대사 녹음 {items.length}개를 줄 순서대로 들어요</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={item.recording.id} className={`rounded-xl px-3 py-2 flex flex-col gap-1 ${playing === item.recording.id ? "bg-blue-soft" : "bg-gray-bg"}`}>
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => (playing === item.recording.id ? stop() : void play(items, i))} className="flex-1 min-w-0 text-left">
                <span className="script-text block text-[13px] text-ink">
                  <span className="font-extrabold text-me-soft mr-1.5">{item.role}</span>
                  {item.text}
                </span>
                <span className="block text-[11.5px] text-ink-4 mt-0.5">
                  {durationLabel(item.recording.duration_ms)} · {playing === item.recording.id ? "재생 중" : "듣기"}
                </span>
              </button>
              <button type="button" disabled={busyId === item.recording.id} onClick={() => void remove(item.recording)} className="shrink-0 text-[11.5px] font-bold text-ink-4">
                {busyId === item.recording.id ? "지우는 중…" : "지우기"}
              </button>
            </div>
            {item.recording.transcript && <p className="text-[12px] text-ink-3">방금 말한 것: {item.recording.transcript}</p>}
          </li>
        ))}
      </ul>
      {error && <p className="text-[12px] text-red">{error}</p>}
    </div>
  );
}
