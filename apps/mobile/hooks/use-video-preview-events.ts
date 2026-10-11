import type { VideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';

import { logEvent } from '@/lib/analytics';
import { createPreviewTracker, type PreviewParams, type PreviewScreen } from '@/lib/video-preview-events';

/**
 * 영상 플레이어에 붙여 사용자가 자기 영상을 틀어 봤는지 기록한다(lib/video-preview-events.ts).
 * sourceKey 는 영상이 바뀐 것을 알아보는 값(주소·id). null 이면 걸린 영상이 없어 세지 않는다.
 */
export function useVideoPreviewEvents(
  player: VideoPlayer,
  screen: PreviewScreen,
  sourceKey: string | null,
  params: PreviewParams = {},
): void {
  const tracker = useRef(createPreviewTracker(screen, (name, p) => void logEvent(name, p))).current;
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    tracker.setSource(sourceKey, JSON.parse(paramsKey) as PreviewParams);
  }, [tracker, sourceKey, paramsKey]);

  useEffect(() => {
    const playing = player.addListener('playingChange', ({ isPlaying }) => tracker.onPlaying(isPlaying));
    const end = player.addListener('playToEnd', () => tracker.onEnd());
    return () => {
      playing.remove();
      end.remove();
    };
  }, [player, tracker]);
}
