import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';

import { limitVideoBuffer } from '@/lib/video-memory';

/**
 * 남의 참여작 썸네일(SOMA-986). 서버는 남의 참여작에 포스터를 주지 않는다 — 원본에서 뜬 포스터는 모자이크 참여작의 얼굴을
 * 드러내기 때문이다. 그래서 앱이 그 사람이 실제로 보게 될 재생 주소(모자이크본이면 모자이크본)의 첫 장면을 직접 뜬다.
 * 서버에 얼굴이 담긴 새 사본을 남기지 않는다.
 *
 * 플레이어는 한 번에 하나만 만들고 썸네일을 뜨면 바로 놓는다(안드로이드 영상 메모리, SOMA-699).
 * 앱이 켜져 있는 동안은 참여작 id 로 기억해 같은 영상을 다시 뜨지 않는다.
 */
const cache = new Map<string, VideoThumbnail>();
let queue: Promise<unknown> = Promise.resolve();

export const THUMB_AT_SEC = 0.5;
const READY_TIMEOUT_MS = 6000;

export function cachedEntryThumb(entryId: string): VideoThumbnail | null {
  return cache.get(entryId) ?? null;
}

/** 썸네일을 뜬다. 못 뜨면 null(칸은 회색으로 남는다). 요청은 줄을 세워 하나씩 처리한다. */
export function loadEntryThumb(entryId: string, url: string, maxWidth = 240): Promise<VideoThumbnail | null> {
  const hit = cache.get(entryId);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cache.get(entryId);
    if (again) return again;
    let player: VideoPlayer | null = null;
    try {
      player = createVideoPlayer({ uri: url });
      player.muted = true;
      limitVideoBuffer(player);
      await waitUntilLoaded(player);
      // iOS 네이티브는 시각 배열만 받는다 — 숫자 하나를 넘기면 앱이 꺼졌다(SOMA-1049). 타입은 숫자도 허용한다.
      const [thumb] = await player.generateThumbnailsAsync([THUMB_AT_SEC], { maxWidth });
      if (thumb) cache.set(entryId, thumb);
      return thumb ?? null;
    } catch {
      return null;
    } finally {
      player?.release();
    }
  });
  queue = job.catch(() => null);
  return job;
}

/** iOS 는 영상 정보를 읽은 뒤라야 장면을 뜰 수 있다. 너무 오래 걸리면 그냥 시도한다. */
function waitUntilLoaded(player: VideoPlayer): Promise<void> {
  if (player.status !== 'idle' && player.status !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, READY_TIMEOUT_MS);
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status !== 'loading' && status !== 'idle') done();
    });
    function done() {
      clearTimeout(timer);
      sub.remove();
      resolve();
    }
  });
}

/** 테스트용 — 기억해 둔 썸네일을 비운다. */
export function resetEntryThumbs(): void {
  cache.clear();
  queue = Promise.resolve();
}
