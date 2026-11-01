"use client";

/**
 * /library(목록)와 /library/<id>(상세). 상세는 프리렌더한 껍데기 하나를 rewrite 로 서빙하고 브라우저가 경로에서
 * id 를 읽는다. 게스트가 없으면 볼 자료도 없으므로 서버에 묻지 않는다(account.guest).
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGuestSession } from "@/features/consent/use-guest-session";
import { errorMessage } from "@/lib/api/v2/errors";
import { deleteVideo, getVideo, listVideos, purgeVideoFile, setVideoFavorite } from "@/lib/api/v2/videos";
import type { Video, VideoFilter, VideoListResponse } from "@/lib/practice/api-types";
import { useResource } from "@/lib/react/use-resource";
import { videoIdFromPath, videoPlaybackUrl } from "@/features/library/library";
import { LibraryListBody, LibraryVideoBody } from "@/features/library/library-body";

const LIST_FAILED_COPY = "보관함을 불러오지 못했어요.";
const DETAIL_FAILED_COPY = "영상을 불러오지 못했어요.";
const ACTION_FAILED_COPY = "잠시 뒤 다시 시도해 주세요.";
const noop = () => () => {};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-[#191f28]">
      <header className="flex h-14 items-center gap-3 border-b border-[#edf0f3] px-4 sm:px-5">
        <Link href="/practice/new" className="text-[13px] font-black text-[#4e5968]">
          연습
        </Link>
        <span className="text-[13px] font-black text-[#3182f6]">보관함</span>
        <Link href="/reading" className="text-[13px] font-black text-[#8b95a1]">
          리딩
        </Link>
      </header>
      {children}
    </div>
  );
}

export function LibraryPage() {
  const pathname = useSyncExternalStore(noop, () => window.location.pathname, () => "");
  if (pathname === "") return <div className="min-h-dvh bg-white" />;
  const videoId = videoIdFromPath(pathname);
  return <Shell>{videoId ? <VideoDetail videoId={videoId} /> : <VideoList />}</Shell>;
}

function VideoList() {
  const { hasSession } = useGuestSession();
  const [filter, setFilter] = useState<VideoFilter>("all");
  const [version, setVersion] = useState(0);
  const [override, setOverride] = useState<Record<string, Video>>({});
  const list = useResource<VideoListResponse>(hasSession ? `${filter}:${version}` : null, (key, signal) => listVideos(key.split(":")[0] as VideoFilter, { signal }), LIST_FAILED_COPY);
  const [error, setError] = useState<string | null>(null);

  const videos = list.state === "ready" ? list.data.videos.map((v) => override[v.id] ?? v) : [];
  const toggleFavorite = async (video: Video) => {
    try {
      const saved = await setVideoFavorite(video.id, !video.favorite);
      setOverride((o) => ({ ...o, [video.id]: saved }));
      if (filter === "favorite") setVersion((v) => v + 1);
    } catch (cause) {
      setError(errorMessage(cause, ACTION_FAILED_COPY));
    }
  };
  return (
    <LibraryListBody
      videos={videos}
      filter={filter}
      onFilter={(f) => {
        setFilter(f);
        setOverride({});
      }}
      loading={hasSession && (list.state === "loading" || list.state === "idle")}
      error={list.state === "failed" ? list.message : error}
      onToggleFavorite={(v) => void toggleFavorite(v)}
    />
  );
}

function VideoDetail({ videoId }: { videoId: string }) {
  const router = useRouter();
  const { hasSession } = useGuestSession();
  const [version, setVersion] = useState(0);
  const detail = useResource<Video>(hasSession ? `${videoId}:${version}` : null, (key, signal) => getVideo(key.slice(0, key.lastIndexOf(":")), { signal }), DETAIL_FAILED_COPY);
  const [local, setLocal] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  if (!hasSession || detail.state === "idle" || detail.state === "loading") return <p className="p-5 text-[13px] font-semibold text-[#8b95a1]">불러오는 중…</p>;
  if (detail.state === "failed") {
    return (
      <p role="alert" className="p-5 text-sm font-bold text-[#e42939]">
        {detail.message}
      </p>
    );
  }
  const video = local ?? detail.data;
  const act = async (work: () => Promise<Video | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      if (next) setLocal(next);
    } catch (cause) {
      setError(errorMessage(cause, ACTION_FAILED_COPY));
    } finally {
      setBusy(false);
    }
  };
  return (
    <LibraryVideoBody
      video={video}
      playbackUrl={videoPlaybackUrl(video)}
      busy={busy}
      error={error}
      onToggleFavorite={() => void act(() => setVideoFavorite(video.id, !video.favorite))}
      onDelete={() =>
        void act(async () => {
          await deleteVideo(video.id);
          router.push("/library");
        })
      }
      onPurge={() => void act(() => purgeVideoFile(video.id))}
      onPlaybackExpired={() => {
        // 서명 주소가 만료됐다 — 목록을 다시 조회해 새 주소를 받는다.
        setLocal(null);
        refetch();
      }}
    />
  );
}
