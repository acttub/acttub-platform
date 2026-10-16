/**
 * expo-audio 재생기를 놓는다(SOMA-670). 재생기의 remove() 는 모듈의 목록에서 빼기만 하고 소리를 멈추지 않는다 —
 * 네이티브 재생기는 JS 가 잊은 뒤 메모리 정리가 돌 때까지 계속 재생돼, 다음 줄로 넘기거나 앱을 내려도 앞 소리가 났다.
 * 그래서 먼저 멈추고, 목록에서 빼고, 네이티브까지 바로 놓는다. 이미 놓은 재생기에 불러도 던지지 않는다.
 */
type DisposablePlayer = { pause(): void; remove(): void; release(): void };

export function disposeAudioPlayer(player: DisposablePlayer | null | undefined): void {
  if (!player) return;
  try {
    player.pause();
  } catch {}
  try {
    player.remove();
  } catch {}
  try {
    player.release();
  } catch {}
}
