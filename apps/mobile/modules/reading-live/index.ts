import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type { LiveState } from '@/lib/reading/live';

/**
 * 리딩을 화면 밖에서 이어 가는 네이티브 모듈(SOMA-802).
 *
 * - iOS: Live Activity(잠금 화면·다이내믹 아일랜드)를 띄우고, 오디오 세션 끊김(전화 등)을 알린다. 배경 소리·녹음은
 *   Info.plist 의 UIBackgroundModes audio 가 맡는다.
 * - Android: 지금은 연결하지 않는다(expo-module.config.json platforms 에서 뺌). 재생·마이크 포그라운드 서비스는
 *   Play 선언(사용 장면 동영상)이 필요해 1.0.0 에서 내렸다. android/ 코드는 다시 켤 때를 위해 남긴다.
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
