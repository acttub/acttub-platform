"use client";

/**
 * 영상 보관함(A2.2 대응)과 보관함 영상(A2.3 대응)의 본문. 목록은 최신 저장순, 필터 전체·최근 7일·즐겨찾기, 비어
 * 있으면 예시 없이 빈 상태. 상세는 재생(서명 주소, 만료 시 재조회)·날짜·길이·저장 상태·사용처·즐겨찾기·"질문
 * 코칭으로 보내기"·삭제(참조가 있으면 video_in_use 안내와 "파일만 파기"). 껍데기는 페이지가 씌운다 — 문구 테스트가
 * 이 본문만 그린다(next/link 를 끌어오지 않도록 <a> 를 쓴다).
 */
import { useState } from "react";
import type { Video, VideoFilter } from "@/lib/practice/api-types";
import {
  DELETE_BLOCKED_COPY,
  DELETE_CONFIRM_COPY,
  durationLabel,
  isReferenced,
  LIBRARY_FILTERS,
  libraryEmptyCopy,
  libraryVideoPath,
  practiceWithVideoPath,
  PURGE_CONFIRM_COPY,
  savedAtLabel,
  usageLabel,
  videoStatusLabel,
} from "@/features/library/library";

const btn = "h-10 rounded-[12px] px-4 text-[13px] font-black transition";
const primary = `${btn} bg-[#3182f6] text-white hover:bg-[#1b64da] disabled:bg-[#c9d3df]`;
const secondary = `${btn} bg-[#f2f4f6] text-[#4e5968] hover:bg-[#e5e8eb] disabled:opacity-40`;
const danger = `${btn} border border-[#f1aeb5] text-[#e03131] hover:bg-[#fff5f5] disabled:opacity-40`;

export function LibraryListBody({
  videos,
  filter,
  onFilter,
  loading,
  error,
  onToggleFavorite,
}: {
  videos: Video[];
  filter: VideoFilter;
  onFilter: (f: VideoFilter) => void;
  loading: boolean;
  error: string | null;
  onToggleFavorite: (video: Video) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#191f28]">보관함</h1>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[#8b95a1]">올린 영상은 여기 남아 코칭으로 보낼 수 있어요.</p>
        </div>
        <a href="/practice/new" className={primary + " flex items-center"}>
          새 연습
        </a>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {LIBRARY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => onFilter(f.value)}
            className={`h-8 rounded-full px-3 text-[12.5px] font-bold ${filter === f.value ? "bg-[#e8f3ff] text-[#3182f6]" : "bg-[#f2f4f6] text-[#4e5968]"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]">
          {error}
        </p>
      )}
      {loading && !error && <p className="text-[13px] font-semibold text-[#8b95a1]">불러오는 중…</p>}
      {!loading && !error && videos.length === 0 && (
        <p className="rounded-[18px] bg-[#f9fafb] px-5 py-8 text-center text-[13.5px] font-semibold leading-6 text-[#6b7684]">{libraryEmptyCopy(filter)}</p>
      )}
      {videos.length > 0 && (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {videos.map((video) => (
            <li key={video.id} className="rounded-[18px] border border-[#edf0f3] bg-white p-3.5">
              <a href={libraryVideoPath(video.id)} className="block">
                <span className="flex h-24 items-center justify-center rounded-xl bg-[#1b2942] text-[11px] font-black text-white">
                  {video.purged_at ? videoStatusLabel(video) : `▶ ${durationLabel(video.duration_ms)}`}
                </span>
                <span className="mt-2.5 block text-[13.5px] font-black text-[#191f28]">{savedAtLabel(video.created_at)}</span>
                <span className="mt-0.5 block text-[12px] font-semibold text-[#8b95a1]">
                  {videoStatusLabel(video)} · {usageLabel(video.usage)}
                </span>
              </a>
              <button
                type="button"
                onClick={() => onToggleFavorite(video)}
                aria-pressed={video.favorite}
                className="mt-2 text-[12px] font-bold text-[#4e5968]"
              >
                {video.favorite ? "★ 즐겨찾기" : "☆ 즐겨찾기"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LibraryVideoBody({
  video,
  playbackUrl,
  busy,
  error,
  onToggleFavorite,
  onDelete,
  onPurge,
  onPlaybackExpired,
}: {
  video: Video;
  /** 살아 있는 서명 주소. 만료됐으면 null 이고 화면이 다시 조회한다. */
  playbackUrl: string | null;
  busy: boolean;
  error: string | null;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onPurge: () => void;
  onPlaybackExpired: () => void;
}) {
  const [confirm, setConfirm] = useState<"delete" | "purge" | null>(null);
  const referenced = isReferenced(video.usage);
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-5">
      <a href="/library" className="text-[13px] font-bold text-[#8b95a1]">
        ← 보관함
      </a>
      {video.purged_at ? (
        <div className="flex aspect-video items-center justify-center rounded-[18px] bg-[#1b2942] text-sm font-black text-white">{videoStatusLabel(video)}</div>
      ) : playbackUrl ? (
        <video key={playbackUrl} src={playbackUrl} controls playsInline onError={onPlaybackExpired} className="aspect-video w-full rounded-[18px] bg-black object-contain" />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-[18px] bg-[#1b2942] text-sm font-semibold text-white">재생 주소를 받는 중…</div>
      )}
      <div className="rounded-[18px] border border-[#edf0f3] bg-white p-4">
        <p className="text-[15px] font-black text-[#191f28]">{savedAtLabel(video.created_at)}</p>
        <p className="mt-1 text-[12.5px] font-semibold text-[#8b95a1]">
          {durationLabel(video.duration_ms)} · {videoStatusLabel(video)}
        </p>
        <p className="mt-2 text-[13px] font-bold text-[#4e5968]">사용처 · {usageLabel(video.usage)}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#e42939]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!video.purged_at && (
          <a href={practiceWithVideoPath(video.id)} className={primary + " flex items-center"}>
            질문 코칭으로 보내기
          </a>
        )}
        <button type="button" disabled={busy} onClick={onToggleFavorite} aria-pressed={video.favorite} className={secondary}>
          {video.favorite ? "★ 즐겨찾기 해제" : "☆ 즐겨찾기"}
        </button>
        {referenced ? (
          !video.purged_at && (
            <button type="button" disabled={busy} onClick={() => setConfirm("purge")} className={danger}>
              파일만 파기
            </button>
          )
        ) : (
          <button type="button" disabled={busy} onClick={() => setConfirm("delete")} className={danger}>
            보관함에서 삭제
          </button>
        )}
      </div>
      {referenced && !video.purged_at && <p className="text-[12px] font-semibold text-[#8b95a1]">{DELETE_BLOCKED_COPY}</p>}
      {confirm && (
        <div className="rounded-[16px] bg-[#fff8ec] p-4">
          <p className="text-[13px] font-bold leading-5 text-[#8a4b00]">{confirm === "delete" ? DELETE_CONFIRM_COPY : PURGE_CONFIRM_COPY}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                if (confirm === "delete") onDelete();
                else onPurge();
              }}
              className={danger}
            >
              {confirm === "delete" ? "지우기" : "파일만 파기"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={secondary}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
