/**
 * 영상 압축의 시간 제한(SOMA-737). 하드웨어 코덱이 막히면 react-native-compressor 가 끝도 없이 돌아
 * 「올리는 중」이 멈춘다 — 영상 길이로 상한을 정하고, 넘으면 압축을 취소해 원본으로 올린다.
 * 네이티브·React Native 를 가져오지 않아 node --test 로 검증한다.
 */
const BASE_MS = 45_000;
const PER_VIDEO_SEC_MS = 2_000;
const MAX_MS = 8 * 60_000;
/** 길이를 못 읽었을 때 */
const UNKNOWN_MS = 120_000;

/** 길이(초)에 따른 압축 상한(ms). 짧은 영상도 45초, 5분 영상은 약 10분을 넘지 않게 8분으로 자른다. */
export function compressTimeoutMs(durationSec: number | null): number {
  if (durationSec === null || !(durationSec > 0)) return UNKNOWN_MS;
  return Math.min(MAX_MS, Math.round(BASE_MS + durationSec * PER_VIDEO_SEC_MS));
}

export class CompressTimeoutError extends Error {
  constructor(ms: number) {
    super(`compress timeout ${ms}ms`);
    this.name = 'CompressTimeoutError';
  }
}

/** promise 가 ms 안에 끝나지 않으면 onTimeout 을 부르고 CompressTimeoutError 로 거절한다. */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      reject(new CompressTimeoutError(ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 진행률이 계속 오를 때 기다리는 전체 상한. 길이로 정한 상한은 "진행이 멈춘 채" 기다리는 시간으로만 쓴다. */
export const COMPRESS_HARD_MAX_MS = 15 * 60_000;

/**
 * 진행률이 오르는 동안은 기다리고, stallMs 동안 진행률이 그대로이거나 maxMs 가 지나면 onTimeout 을 부르고
 * CompressTimeoutError 로 거절한다(SOMA-737 후속). 길이만으로 끊으면 아직 줄이는 중인 영상도 끊겨, 원본이 100MiB 를
 * 넘는 촬영본은 「너무 오래 걸렸어요」로 막혔다(11/4 Galaxy S23 리뷰). start 가 받는 onProgress 를 압축 진행률에 잇는다.
 */
export function withProgressTimeout<T>(
  start: (onProgress: (progress: number) => void) => Promise<T>,
  limits: { stallMs: number; maxMs: number },
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let best = Number.NEGATIVE_INFINITY;
    let stall: ReturnType<typeof setTimeout> | undefined;
    let hard: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      settled = true;
      clearTimeout(stall);
      clearTimeout(hard);
    };
    const expire = (ms: number) => {
      if (settled) return;
      stop();
      try {
        onTimeout?.();
      } catch {}
      reject(new CompressTimeoutError(ms));
    };
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => expire(limits.stallMs), limits.stallMs);
    };
    hard = setTimeout(() => expire(limits.maxMs), limits.maxMs);
    arm();
    const onProgress = (progress: number) => {
      if (settled || !(progress > best)) return;
      best = progress;
      arm();
    };
    let running: Promise<T>;
    try {
      running = start(onProgress);
    } catch (error) {
      stop();
      reject(error);
      return;
    }
    running.then(
      (value) => {
        if (settled) return;
        stop();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        stop();
        reject(error);
      },
    );
  });
}

/** 압축 실패 뒤 원본도 올릴 수 없을 때(100MiB 초과 등). 큐가 항목을 버리지 않고 「실패 · 다시 시도」로 남긴다. */
export class CompressFailedError extends Error {
  readonly retryable = true;
  constructor(reason: string) {
    super(`compress failed: ${reason}`);
    this.name = 'CompressFailedError';
  }
}
