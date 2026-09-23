import { MAX_DURATION_MS, MAX_UPLOAD_BYTES } from "../../config/env";
import { defaultUploader, type S3Uploader, type UploadProgress } from "../../media/s3-uploader";
import { apiFetch } from "./client";
import { UploadError } from "./uploads";
import type { Video, VideoFilter, VideoIntentRequest, VideoIntentResponse, VideoListResponse } from "../../practice/api-types";

// 영상 보관함(practice.record·practice.library). 올리기는 세 단계 — 올릴 자리 받기 · 올리기 · 마무리 —
// 그대로이고 마무리가 videos 행(보관함 저장)을 만든다. 예약 장부가 request_id 를 보존하므로 마무리 재전송은
// 같은 영상이다. 타입은 현재 OpenAPI 계약에서 생성한다.

export type UploadLibraryVideoOptions = {
  /** 기기가 잰 길이(ms). 5분을 넘으면 자리를 받기 전에 거른다. */
  durationMs: number;
  /** 기기가 만든 요청 id. 자리 받기·마무리 재전송이 같은 값을 쓴다. */
  requestId: string;
  signal?: AbortSignal;
  uploader?: S3Uploader;
  onProgress?: (progress: UploadProgress) => void;
};

function throwIfAborted(stage: "intent" | "put" | "complete", signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason instanceof Error ? signal.reason : new DOMException("업로드가 취소되었어요.", "AbortError");
  throw new UploadError(stage, reason.message, reason);
}

/** 기기가 먼저 거른다. 서버도 같은 값을 검사한다(422 video_too_large·video_too_long). */
function validated(file: File, durationMs: number): Omit<VideoIntentRequest, "request_id"> {
  const contentType = file.type.trim().toLowerCase();
  if (!contentType.startsWith("video/") || contentType.length <= "video/".length) {
    throw new UploadError("intent", "동영상 파일만 업로드할 수 있어요.");
  }
  if (file.size < 1) throw new UploadError("intent", "비어 있는 영상은 업로드할 수 없어요.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("intent", "영상이 너무 커요(100MB 이내).");
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) {
    throw new UploadError("intent", "영상이 너무 길어요(5분 이내).");
  }
  return { content_type: contentType, byte_size: file.size, duration_ms: durationMs };
}

/** 세 단계를 한 번에. 끝나면 보관함에 영상이 있다. */
export async function uploadLibraryVideo(file: File, options: UploadLibraryVideoOptions): Promise<Video> {
  const body = validated(file, options.durationMs);
  const headers = { "X-Request-Id": options.requestId };
  let intent: VideoIntentResponse;
  try {
    throwIfAborted("intent", options.signal);
    const { data } = await apiFetch<VideoIntentResponse>("/v2/videos/intents", {
      method: "POST",
      body: { request_id: options.requestId, ...body } satisfies VideoIntentRequest,
      headers,
      signal: options.signal,
    });
    intent = data;
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError("intent", "업로드 준비에 실패했어요.", error);
  }
  try {
    throwIfAborted("put", options.signal);
    await (options.uploader ?? defaultUploader)({
      url: intent.upload_url,
      file,
      contentType: body.content_type,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError("put", error instanceof Error && error.message ? error.message : "영상을 업로드하지 못했어요.", error);
  }
  try {
    throwIfAborted("complete", options.signal);
    const { data } = await apiFetch<Video>(`/v2/videos/intents/${encodeURIComponent(intent.intent_id)}/complete`, {
      method: "POST",
      body: {},
      headers,
      signal: options.signal,
    });
    return data;
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError("complete", "업로드 완료 확인에 실패했어요.", error);
  }
}

/** 내 영상, 최신 저장순. 예시 영상은 섞지 않는다. */
export async function listVideos(filter: VideoFilter = "all", options: { signal?: AbortSignal } = {}): Promise<VideoListResponse> {
  const { data } = await apiFetch<VideoListResponse>(`/v2/videos?filter=${filter}`, { signal: options.signal });
  return data;
}

/** 상세 — 서명 재생 주소(만료 시 재조회)와 사용처 */
export async function getVideo(videoId: string, options: { signal?: AbortSignal } = {}): Promise<Video> {
  const { data } = await apiFetch<Video>(`/v2/videos/${encodeURIComponent(videoId)}`, { signal: options.signal });
  return data;
}

export async function setVideoFavorite(videoId: string, favorite: boolean): Promise<Video> {
  const { data } = await apiFetch<Video>(`/v2/videos/${encodeURIComponent(videoId)}`, { method: "PATCH", body: { favorite } });
  return data;
}

/** 참조(회차·참여작)가 없을 때만 된다. 있으면 422 video_in_use 이고 아무것도 지워지지 않는다. */
export async function deleteVideo(videoId: string): Promise<void> {
  await apiFetch<void>(`/v2/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" });
}

/** 참조가 있는 영상의 파일만 파기 — 회차·참여작 기록은 남고 재생만 막히며 총량에서 빠진다. */
export async function purgeVideoFile(videoId: string): Promise<Video> {
  const { data } = await apiFetch<Video>(`/v2/videos/${encodeURIComponent(videoId)}/purge-file`, { method: "POST", body: {} });
  return data;
}
