/**
 * 내 차례 닫기 — [다음]이 받아쓰기 마무리·마이크 정지를 기다리다 멈추지 않게 한다(11/2 QA 「다음이 가끔 안 먹힌다」).
 * 기다릴 일이 늦거나 실패해도 ms 뒤에는 fallback 으로 끝난다. 하던 일은 뒤에서 계속 돈다.
 */
export const STT_FINISH_MAX_MS = 1500;
export const MIC_STOP_MAX_MS = 1500;

export function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
