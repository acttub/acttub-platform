import { abortError, throwIfAborted } from "./abort";

export async function videoDuration(
  file: File,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  const url = URL.createObjectURL(file);

  try {
    const durationMs = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      let settled = false;

      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const succeed = (value: number) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        video.removeAttribute("src");
        video.load();
        fail(abortError(signal));
      };

      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const seconds = video.duration;
        if (!Number.isFinite(seconds) || seconds <= 0) {
          fail(new Error("영상 길이를 확인하지 못했어요."));
          return;
        }
        succeed(Math.round(seconds * 1000));
      };
      video.onerror = () => fail(new Error("영상 길이를 확인하지 못했어요."));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      video.src = url;
    });
    throwIfAborted(signal);
    return durationMs;
  } finally {
    URL.revokeObjectURL(url);
  }
}
