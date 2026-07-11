"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPracticeSignedVideoUrl } from "@/lib/api/practice";

export type PrivateVideoHandle = { seekTo: (startMs: number) => void };

export const PrivateVideo = forwardRef<PrivateVideoHandle, { sessionId: string }>(
  function PrivateVideo({ sessionId }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await createPracticeSignedVideoUrl(sessionId);
        setSignedUrl(result.signedUrl);
      } catch (reason) {
        setSignedUrl(null);
        setError(reason instanceof Error ? reason.message : "영상을 불러오지 못했어요.");
      } finally {
        setLoading(false);
      }
    }, [sessionId]);

    useEffect(() => { void refresh(); }, [refresh]);
    useImperativeHandle(ref, () => ({
      seekTo(startMs) {
        if (videoRef.current) {
          videoRef.current.currentTime = startMs / 1000;
          void videoRef.current.play();
        }
      },
    }), []);

    return (
      <section className="rounded-3xl bg-black p-3 text-white" aria-labelledby="practice-video-title">
        <div className="mb-3 flex items-center justify-between gap-3 px-2">
          <h2 id="practice-video-title" className="font-semibold">내 연습 영상</h2>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-full bg-white/15 px-4 py-2 text-sm disabled:opacity-50">
            {loading ? "불러오는 중" : "영상 링크 새로고침"}
          </button>
        </div>
        {signedUrl ? <video ref={videoRef} data-testid="pipeline-private-video" controls preload="metadata" src={signedUrl} className="aspect-video w-full rounded-2xl bg-black" /> : <p className="p-8 text-center text-sm text-white/70">{error ?? "안전한 영상 링크를 준비하고 있어요."}</p>}
      </section>
    );
  },
);
