/**
 * 짧은 효과음(11/2 우영: 연습이 끝날 때, 불꽃이 나올 때만).
 *
 * 연습 중에는 상대 목소리·마이크를 쓰므로 소리를 내지 않는다. 끝난 화면과 불꽃 축하가 처음 뜰 때 한 번씩만 낸다.
 * 소리 파일은 직접 만든 짧은 차임이다(assets/audio/fx-*.m4a). 모듈을 못 쓰면(테스트·옛 빌드) 조용히 넘어간다.
 */
type Player = { play: () => void; remove: () => void; volume?: number };

const SOURCES = {
  complete: require('@/assets/audio/fx-complete.m4a'),
  flame: require('@/assets/audio/fx-flame.m4a'),
} as const;

export type SoundEffect = keyof typeof SOURCES;

/** 한 번 재생하고 끝나면 놓는다. 볼륨은 기기 미디어 볼륨을 따른다(무음 모드에서는 iOS 가 소리를 내지 않는다). */
export function playSoundEffect(effect: SoundEffect): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAudioPlayer } = require('expo-audio') as { createAudioPlayer: (src: unknown) => Player };
    const player = createAudioPlayer(SOURCES[effect]);
    if ('volume' in player) player.volume = 0.6;
    player.play();
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        // 이미 놓였으면 그대로 둔다.
      }
    }, 3000);
  } catch {
    // 효과음은 곁다리다 — 못 내도 화면은 그대로 간다.
  }
}
