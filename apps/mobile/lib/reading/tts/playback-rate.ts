/**
 * 리딩 목소리 재생 속도(앱 1.1.1, SOMA-952). 리딩 화면이 회차를 시작할 때 정하고, 저장본 재생(engine.play — 고품질·앱·예시
 * 목소리)과 기기 기본 목소리(device-voice)가 같이 읽는다. 1 이 보통 속도다.
 */
let current = 1;

export function setReadingPlaybackRate(rate: number): void {
  current = Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function readingPlaybackRate(): number {
  return current;
}
