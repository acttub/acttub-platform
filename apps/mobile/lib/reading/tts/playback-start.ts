/**
 * 상대 목소리의 소리가 실제로 나기 시작한 때를 화면에 알린다(리딩 회차 요약의 partner_wait, lib/reading/run-summary).
 * 저장본 재생(engine.play)은 재생기가 「재생 중」을 알린 때, 기기 목소리(device-voice)는 OS 음성의 onStart 때 부른다.
 * 듣는 쪽은 하나뿐이다(리딩 화면). 듣는 쪽의 오류는 재생을 막지 않는다.
 */
let listener: (() => void) | null = null;

export function setPlaybackStartListener(next: (() => void) | null): void {
  listener = next;
}

export function notifyPlaybackStart(): void {
  try {
    listener?.();
  } catch {
    // 계측 실패는 재생과 상관없다.
  }
}
