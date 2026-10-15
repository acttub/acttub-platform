import { Platform } from 'react-native';

/**
 * 안드로이드 영상 플레이어가 미리 받아 두는 양(SOMA-699). 기본은 20초·크기 제한 없음이라 플레이어 하나가 앱 메모리를
 * 20MB 넘게 잡았고, 영상 화면이 여러 개 겹친 긴 세션에서 앱 메모리(256MB)가 차 꺼졌다. 연습·참여작 영상은 1분 남짓이라
 * 10초·10MB 면 끊기지 않고 볼 수 있다.
 */
export const ANDROID_VIDEO_BUFFER = {
  preferredForwardBufferDuration: 10,
  minBufferForPlayback: 2,
  maxBufferBytes: 10 * 1024 * 1024,
} as const;

type BufferedPlayer = { bufferOptions: object };

/** useVideoPlayer 의 setup 에서 부른다. iOS 는 시스템이 알아서 정하므로 손대지 않는다. */
export function limitVideoBuffer(player: BufferedPlayer): void {
  if (Platform.OS !== 'android') return;
  player.bufferOptions = { ...ANDROID_VIDEO_BUFFER };
}

/**
 * 화면이 가려져 있는 동안은 영상 주소를 넘기지 않는다 — useVideoPlayer 는 주소가 바뀌면 옛 플레이어를 놓으므로, 위에
 * 다른 화면이 쌓여도 아래 화면의 플레이어가 메모리를 잡고 있지 않는다. 돌아오면 다시 불러온다.
 */
export function sourceWhileFocused<T>(source: T, focused: boolean): T | null {
  return focused ? source : null;
}
