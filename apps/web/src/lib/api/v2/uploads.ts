import { MAX_DURATION_MS, MAX_UPLOAD_BYTES, MOCK_S3_UPLOAD } from "../../config/env";
import { browserS3Uploader, fakeS3Uploader } from "../../media/s3-uploader";
import { apiFetch } from "./client";
import { ApiError, errorMessage } from "./errors";
import type {
  UploadCompleteResponse,
  UploadIntentRequest,
  UploadIntentResponse,
} from "./types";

export type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
};

export type S3Uploader = (args: {
  url: string;
  file: Blob;
  contentType: string;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}) => Promise<void>;

export type UploadStage = "intent" | "put" | "complete";

export class UploadError extends Error {
  readonly cause: unknown;

  constructor(
    readonly stage: UploadStage,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = isAbortError(cause) ? "AbortError" : "UploadError";
    this.cause = cause;
  }
}

export type UploadVideoOptions = {
  durationMs?: number;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  uploader?: S3Uploader;
  /**
   * false 면 S3 PUT 까지만 하고 완료 처리는 finalizeUpload 로 미룬다.
   * 완료된 인텐트는 만료 스윕이 회수하지 않으므로(PENDING 만 본다), 배우가 아직
   * 연습을 시작하겠다고 하기 전에 완료해 두면 도중에 그만둔 영상이 S3 에 영영 남는다.
   */
  finalize?: boolean;
};

type UploadRequestOptions = {
  signal?: AbortSignal;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (isAbortError(reason)) return reason as Error;

  const error = new DOMException("업로드가 취소되었어요.", "AbortError");
  if (reason !== undefined) {
    Object.defineProperty(error, "cause", { value: reason });
  }
  return error;
}

function asUploadError(
  stage: UploadStage,
  error: unknown,
  fallback: string,
): UploadError {
  if (error instanceof UploadError) return error;
  return new UploadError(stage, errorMessage(error, fallback), error);
}

// 실제 PUT 은 공용 업로더(src/lib/media/s3-uploader.ts)가 한다 — 영상 보관함(videos.ts)과 같은 것이다.
// 이 계층의 오류 모양(UploadError "put")으로 감싼다.
const xhrS3Uploader: S3Uploader = (args) =>
  browserS3Uploader(args).catch((error) => {
    throw error instanceof UploadError ? error : asUploadError("put", error, "영상을 업로드하지 못했어요.");
  });

const mockS3Uploader: S3Uploader = (args) =>
  fakeS3Uploader(args).catch((error) => {
    throw error instanceof UploadError ? error : asUploadError("put", error, "영상을 업로드하지 못했어요.");
  });

const defaultS3Uploader: S3Uploader = MOCK_S3_UPLOAD
  ? mockS3Uploader
  : xhrS3Uploader;

async function createUploadIntent(
  body: UploadIntentRequest,
  options: UploadRequestOptions = {},
): Promise<UploadIntentResponse> {
  const { data } = await apiFetch<UploadIntentResponse>("/v2/uploads/intents", {
    method: "POST",
    body,
    signal: options.signal,
  });
  return data;
}

async function completeUploadIntent(
  intentId: string,
  options: UploadRequestOptions = {},
): Promise<UploadCompleteResponse> {
  const { data } = await apiFetch<UploadCompleteResponse>(
    `/v2/uploads/intents/${encodeURIComponent(intentId)}/complete`,
    { method: "POST", signal: options.signal },
  );
  return data;
}

function throwIfAborted(stage: UploadStage, signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = abortError(signal);
  throw new UploadError(stage, error.message, error);
}

function validatedUpload(file: File, durationMs?: number): {
  contentType: string;
  request: UploadIntentRequest;
} {
  const contentType = file.type.trim().toLowerCase();
  if (!contentType.startsWith("video/") || contentType.length <= "video/".length) {
    throw new UploadError("intent", "동영상 파일만 업로드할 수 있어요.");
  }
  if (file.size < 1) {
    throw new UploadError("intent", "비어 있는 영상은 업로드할 수 없어요.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      "intent",
      `영상 파일은 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하여야 해요.`,
    );
  }
  if (
    durationMs !== undefined &&
    (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS)
  ) {
    throw new UploadError(
      "intent",
      `영상 길이는 1ms 이상 ${Math.floor(MAX_DURATION_MS / 60_000)}분 이하여야 해요.`,
    );
  }

  return {
    contentType,
    request: {
      mime_type: contentType,
      size_bytes: file.size,
      ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    },
  };
}

function isMockUploadNotFound(error: unknown, uploader: S3Uploader): boolean {
  return (
    uploader === mockS3Uploader &&
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === "upload_not_found" || error.detail === "upload_not_found")
  );
}

export async function uploadVideo(
  file: File,
  options: UploadVideoOptions = {},
): Promise<{ intentId: string }> {
  const { contentType, request } = validatedUpload(file, options.durationMs);
  const uploader = options.uploader ?? defaultS3Uploader;

  let intent: UploadIntentResponse;
  try {
    throwIfAborted("intent", options.signal);
    intent = await createUploadIntent(request, { signal: options.signal });
  } catch (error) {
    throw asUploadError("intent", error, "업로드 준비에 실패했어요.");
  }

  try {
    throwIfAborted("put", options.signal);
    await uploader({
      url: intent.upload_url,
      file,
      contentType,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (error) {
    throw asUploadError("put", error, "영상을 업로드하지 못했어요.");
  }

  if (options.finalize === false) return { intentId: intent.intent_id };

  try {
    throwIfAborted("complete", options.signal);
    await completeUploadIntent(intent.intent_id, { signal: options.signal });
  } catch (error) {
    if (isMockUploadNotFound(error, uploader)) {
      throw new UploadError(
        "complete",
        "mock 업로드는 실제 S3 객체가 없어 finalize 불가 — S3 CORS 설정 또는 백엔드 스토리지 페이크 필요",
        error,
      );
    }
    throw asUploadError("complete", error, "업로드 완료 확인에 실패했어요.");
  }

  return { intentId: intent.intent_id };
}

/** finalize:false 로 올린 인텐트를 뒤늦게 완료 처리한다. */
export async function finalizeUpload(
  intentId: string,
  options: UploadRequestOptions = {},
): Promise<void> {
  try {
    throwIfAborted("complete", options.signal);
    await completeUploadIntent(intentId, { signal: options.signal });
  } catch (error) {
    if (
      MOCK_S3_UPLOAD
      && error instanceof ApiError
      && error.status === 409
      && (error.code === "upload_not_found" || error.detail === "upload_not_found")
    ) {
      throw new UploadError(
        "complete",
        "mock 업로드는 실제 S3 객체가 없어 finalize 불가 — S3 CORS 설정 또는 백엔드 스토리지 페이크 필요",
        error,
      );
    }
    throw asUploadError("complete", error, "업로드 완료 확인에 실패했어요.");
  }
}
