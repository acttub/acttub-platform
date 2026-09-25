/** 영상 업로드의 실패 단계. HTTP 호출은 videos.ts 가 소유한다. */
export type UploadStage = "intent" | "put" | "complete";
export class UploadError extends Error {
  readonly cause: unknown;
  constructor(readonly stage: UploadStage, message: string, cause?: unknown) {
    super(message);
    this.name = cause instanceof Error && cause.name === "AbortError" ? "AbortError" : "UploadError";
    this.cause = cause;
  }
}
