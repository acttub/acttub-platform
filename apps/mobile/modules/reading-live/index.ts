import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { AppRegistry, Platform } from 'react-native';

import type { LiveState } from '@/lib/reading/live';

/**
 * 리딩을 화면 밖에서 이어 가는 네이티브 모듈(SOMA-802).
 *
 * - iOS: Live Activity(잠금 화면·다이내믹 아일랜드)를 띄우고, 오디오 세션 끊김(전화 등)을 알린다. 배경 소리·녹음은
 *   Info.plist 의 UIBackgroundModes audio 가 맡는다.
 * - Android: 재생(mediaPlayback) 포그라운드 서비스만 띄운다(앱 1.1.1). 배경에서 마이크는 열지 않으므로 keepsRunning 은
 *   false — 말하기 회차는 배경으로 가면 멈추고, 전체 듣기·자동 넘김만 계속 돈다. 배경에서 JS 타이머가 멈추지 않게
 *   서비스가 떠 있는 동안 헤드리스 작업(ReadingKeepAlive)을 하나 잡아 둔다.
 *
 * 모듈이 없는 실행(Expo Go·테스트)에서는 아무것도 하지 않고 keepsRunning 은 false 다 — 화면은 예전처럼 배경에서 멈춘다.
 */
type Events = {
  /** 잠금 화면·알림의 [일시정지]. */
  onPause: () => void;
  /** 전화 등으로 소리가 실제로 끊겼다. */
  onInterrupt: () => void;
};

declare class ReadingLiveNative extends NativeModule<Events> {
  start(state: LiveState, channelName: string): void;
  update(state: LiveState): void;
  stop(): void;
  keepsRunning(): boolean;
}

const native = requireOptionalNativeModule<ReadingLiveNative>('ReadingLive');

// 안드로이드 리딩 서비스가 잡아 두는 헤드리스 작업 — 끝나지 않는 약속만 돌려준다. 네이티브가 서비스를 내릴 때 작업을 끝낸다.
if (Platform.OS === 'android' && native) {
  AppRegistry.registerHeadlessTask('ReadingKeepAlive', () => () => new Promise<void>(() => {}));
}

export function startReadingLive(state: LiveState, channelName: string): void {
  native?.start(state, channelName);
}

export function updateReadingLive(state: LiveState): void {
  native?.update(state);
}

export function stopReadingLive(): void {
  native?.stop();
}

/** 앱이 배경에 있어도 리딩(소리·마이크)이 계속 도는가. 아니면 화면이 배경으로 갈 때 멈춘다. */
export function readingKeepsRunning(): boolean {
  return native?.keepsRunning() ?? false;
}

export function onReadingLiveEvent(name: keyof Events, listener: () => void): () => void {
  const sub = native?.addListener(name, listener);
  return () => sub?.remove();
}
