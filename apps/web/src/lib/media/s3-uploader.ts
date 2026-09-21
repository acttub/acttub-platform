/**
 * 서명 주소로 파일을 PUT 하는 업로더. 영상 보관함(src/lib/api/v2/videos.ts)이 쓴다.
 * 옛 업로드 계층(src/lib/api/v2/uploads.ts)도 같은 것을 쓴다.
 */
import { MOCK_S3_UPLOAD } from "../config/env";

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

export class S3PutError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = cause instanceof Error && cause.name === "AbortError" ? "AbortError" : "S3PutError";
  }
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("업로드가 취소되었어요.", "AbortError");
}

function emitProgress(onProgress: ((p: UploadProgress) => void) | undefined, loadedBytes: number, totalBytes: number): void {
  if (!onProgress) return;
  const bounded = Math.max(0, Math.min(loadedBytes, totalBytes));
  onProgress({ loadedBytes: bounded, totalBytes, percent: totalBytes > 0 ? Math.round((bounded / totalBytes) * 100) : 0 });
}

export const browserS3Uploader: S3Uploader = ({ url, file, contentType, signal, onProgress }) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const error = abortError(signal);
      reject(new S3PutError(error.message, error));
      return;
    }
    if (typeof XMLHttpRequest === "undefined") {
      reject(new S3PutError("현재 환경에서는 브라우저 S3 업로드를 사용할 수 없어요.", new Error("XMLHttpRequest is not available")));
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    let lastLoaded = 0;
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
        fail(new S3PutError("업로드를 취소하지 못했어요.", error));
      }
    };
    try {
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
    } catch (error) {
      fail(new S3PutError("S3 업로드 요청을 준비하지 못했어요.", error));
      return;
    }
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      lastLoaded = Math.max(lastLoaded, event.loaded);
      emitProgress(onProgress, lastLoaded, total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (lastLoaded < file.size) emitProgress(onProgress, file.size, file.size);
        succeed();
        return;
      }
      fail(
        new S3PutError(
          xhr.status === 403 ? "업로드 URL이 만료되었을 수 있어요. 업로드를 처음부터 다시 시도해 주세요." : `영상 업로드에 실패했어요. (HTTP ${xhr.status})`,
        ),
      );
    };
    xhr.onerror = () => fail(new S3PutError("네트워크 문제로 영상을 업로드하지 못했어요."));
    xhr.onabort = () => {
      const error = abortError(signal);
      fail(new S3PutError(error.message, error));
    };
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    try {
      xhr.send(file);
    } catch (error) {
      fail(new S3PutError("영상을 업로드하지 못했어요.", error));
    }
  });

/** S3 CORS 가 없는 개발 환경용 — 올린 척만 한다. */
export const fakeS3Uploader: S3Uploader = async ({ file, signal, onProgress }) => {
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        const error = abortError(signal);
        reject(new S3PutError(error.message, error));
        return;
      }
      const timer = setTimeout(resolve, 40);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          const error = abortError(signal);
          reject(new S3PutError(error.message, error));
        },
        { once: true },
      );
    });
    onProgress?.({ loadedBytes: step === steps ? file.size : Math.round((file.size * step) / steps), totalBytes: file.size, percent: step * 10 });
  }
};

export const defaultUploader: S3Uploader = MOCK_S3_UPLOAD ? fakeS3Uploader : browserS3Uploader;
