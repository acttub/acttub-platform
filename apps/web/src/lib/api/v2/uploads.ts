import { MAX_DURATION_MS, MAX_UPLOAD_BYTES, MOCK_S3_UPLOAD } from "../../config/env";
import { apiFetch } from "./client";
import { ApiError } from "./errors";
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function asUploadError(
  stage: UploadStage,
  error: unknown,
  fallback: string,
): UploadError {
  if (error instanceof UploadError) return error;
  return new UploadError(stage, messageOf(error, fallback), error);
}

function emitProgress(
  onProgress: ((progress: UploadProgress) => void) | undefined,
  loadedBytes: number,
  totalBytes: number,
): void {
  if (!onProgress) return;
  const boundedLoaded = Math.max(0, Math.min(loadedBytes, totalBytes));
  const percent =
    totalBytes > 0 ? Math.round((boundedLoaded / totalBytes) * 100) : 0;
  onProgress({ loadedBytes: boundedLoaded, totalBytes, percent });
}

const xhrS3Uploader: S3Uploader = ({
  url,
  file,
  contentType,
  signal,
  onProgress,
}) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const error = abortError(signal);
      reject(new UploadError("put", error.message, error));
      return;
    }
    if (typeof XMLHttpRequest === "undefined") {
      reject(
        new UploadError(
          "put",
          "현재 환경에서는 브라우저 S3 업로드를 사용할 수 없어요.",
          new Error("XMLHttpRequest is not available"),
        ),
      );
      return;
    }

    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
    } catch (error) {
      reject(
        asUploadError(
          "put",
          error,
          "현재 환경에서는 브라우저 S3 업로드를 사용할 수 없어요.",
        ),
      );
      return;
    }
    let settled = false;
    let lastLoadedBytes = 0;

    const cleanup = () => signal?.removeEventListener("abort", onSignalAbort);
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onSignalAbort = () => {
      try {
        xhr.abort();
      } catch (error) {
        fail(asUploadError("put", error, "업로드를 취소하지 못했어요."));
      }
    };

    try {
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
    } catch (error) {
      fail(asUploadError("put", error, "S3 업로드 요청을 준비하지 못했어요."));
      return;
    }
    xhr.upload.onprogress = (event) => {
      const totalBytes =
        event.lengthComputable && event.total > 0 ? event.total : file.size;
      lastLoadedBytes = Math.max(lastLoadedBytes, event.loaded);
      emitProgress(onProgress, lastLoadedBytes, totalBytes);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (lastLoadedBytes < file.size) {
          emitProgress(onProgress, file.size, file.size);
        }
        succeed();
        return;
      }

      fail(
        new UploadError(
          "put",
          xhr.status === 403
            ? "업로드 URL이 만료되었을 수 있어요. 업로드를 처음부터 다시 시도해 주세요."
            : `영상 업로드에 실패했어요. (HTTP ${xhr.status})`,
        ),
      );
    };
    xhr.onerror = () =>
      fail(
        new UploadError(
          "put",
          "네트워크 문제로 영상을 업로드하지 못했어요.",
        ),
      );
    xhr.onabort = () => {
      const error = abortError(signal);
      fail(new UploadError("put", error.message, error));
    };

    signal?.addEventListener("abort", onSignalAbort, { once: true });
    try {
      xhr.send(file);
    } catch (error) {
      fail(asUploadError("put", error, "영상을 업로드하지 못했어요."));
    }
  });

function mockWait(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const error = abortError(signal);
    return Promise.reject(new UploadError("put", error.message, error));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 40);
    const onAbort = () => {
      clearTimeout(timer);
      const error = abortError(signal);
      reject(new UploadError("put", error.message, error));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const mockS3Uploader: S3Uploader = async ({
  file,
  signal,
  onProgress,
}) => {
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await mockWait(signal);
    const loadedBytes =
      step === steps ? file.size : Math.round((file.size * step) / steps);
    onProgress?.({
      loadedBytes,
      totalBytes: file.size,
      percent: step * 10,
    });
  }
};

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
