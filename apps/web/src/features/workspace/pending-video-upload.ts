export type PendingVideoUpload<TResult> = {
  file: File;
  controller: AbortController;
  promise: Promise<TResult>;
};

/** 현재 선택한 File 로 시작한 업로드만 이어받는다. */
export function uploadForCurrentFile<TResult>(
  pending: PendingVideoUpload<TResult> | null,
  file: File,
  startUpload: (file: File) => PendingVideoUpload<TResult>,
): PendingVideoUpload<TResult> {
  if (pending?.file === file) return pending;
  pending?.controller.abort();
  return startUpload(file);
}
