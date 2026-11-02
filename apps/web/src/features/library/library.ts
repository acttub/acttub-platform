/**
 * 영상 보관함(practice.library)의 화면 규칙. 순수 함수라 화면 없이 테스트한다.
 */
import type { Video, VideoFilter, VideoUsage } from "@/lib/practice/api-types";

export const LIBRARY_FILTERS: { value: VideoFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "recent7", label: "최근 7일" },
  { value: "favorite", label: "즐겨찾기" },
];

/** 파일만 파기한 영상. 회차·참여작 기록은 남지만 재생은 막힌다. */
export const PURGED_COPY = "재생할 수 없어요";
export const SAVED_COPY = "보관함 저장";
export const DELETE_BLOCKED_COPY = "회차나 챌린지에 쓰인 영상이라 지울 수 없어요. 파일만 파기할 수 있어요.";
export const DELETE_CONFIRM_COPY = "이 영상을 보관함에서 지워요. 되돌릴 수 없어요.";
export const PURGE_CONFIRM_COPY = "영상 파일만 파기해요. 회차·챌린지 기록은 남지만 이 영상은 다시 재생할 수 없어요.";

export function libraryEmptyCopy(filter: VideoFilter): string {
  if (filter === "favorite") return "즐겨찾기한 영상이 없어요.";
  if (filter === "recent7") return "최근 7일에 저장한 영상이 없어요.";
  return "아직 보관한 영상이 없어요. 새 연습에서 영상을 올리면 여기에 남아요.";
}

export function usageLabel(usage: VideoUsage): string {
  return `회차 ${usage.practice_count}개 · 챌린지 참여작 ${usage.entry_count}개`;
}

export function videoStatusLabel(video: Pick<Video, "purged_at">): string {
  return video.purged_at ? PURGED_COPY : SAVED_COPY;
}

/** 참조가 있으면 삭제 대신 "파일만 파기"가 길이다. */
export function isReferenced(usage: VideoUsage): boolean {
  return usage.practice_count > 0 || usage.entry_count > 0;
}

/** 살아 있는 서명 재생 주소. 만료됐거나 파기됐으면 null — 부르는 쪽이 다시 조회한다. */
export function videoPlaybackUrl(video: Pick<Video, "playback_url" | "playback_expires_at" | "purged_at">, now: Date = new Date()): string | null {
  if (video.purged_at || !video.playback_url || !video.playback_expires_at) return null;
  const expires = new Date(video.playback_expires_at).getTime();
  return Number.isNaN(expires) || expires <= now.getTime() ? null : video.playback_url;
}

export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function savedAtLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${pick("year")}년 ${pick("month")}월 ${pick("day")}일`;
}

/** 보관함 상세 경로. 프리렌더한 껍데기(/library)를 rewrite 로 서빙하고 브라우저가 경로에서 id 를 읽는다. */
export function libraryVideoPath(videoId: string): string {
  return `/library/${encodeURIComponent(videoId)}`;
}

export function videoIdFromPath(pathname: string): string | null {
  const match = /^\/library\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return null;
  }
}

/** 보관함에서 "질문 코칭으로 보내기" — 새 연습 준비 화면이 이 영상을 들고 선다. */
export function practiceWithVideoPath(videoId: string): string {
  return `/practice/new?video=${encodeURIComponent(videoId)}`;
}
