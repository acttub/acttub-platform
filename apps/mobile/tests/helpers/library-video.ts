import type { Video } from '@/lib/library/types';
import type { QueuedVideo } from '@/lib/library/upload-queue';

export function libraryVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'v1',
    duration_ms: 65_000,
    byte_size: 1_000,
    content_type: 'video/mp4',
    favorite: false,
    purged_at: null,
    created_at: new Date().toISOString(),
    usage: { practice_count: 0, entry_count: 0 },
    playback_url: null,
    playback_expires_at: null,
    poster_url: null,
    ...overrides,
  };
}

export function queuedVideo(overrides: Partial<QueuedVideo> = {}): QueuedVideo {
  return {
    id: 'q1',
    owner: 'u1',
    requestId: 'r1',
    uri: 'file:///q1.mp4',
    contentType: 'video/mp4',
    durationMs: 12_000,
    createdAt: Date.now(),
    intentId: null,
    intentExpiresAt: null,
    status: 'queued',
    lastError: null,
    ...overrides,
  };
}
