/**
 * 옛 앱의 기기 보관함(계정 구분 없는 목록, `acttub.archive.v1`)을 1.0.0 첫 실행 때 "이 영상들을 지금 계정의 보관함으로
 * 옮길까요?"로 한 번 묻고 확인한 것만 올린다(practice.record). 확인하지 않으면 기기에 남기고 다음 실행에 다시 묻는다
 * — 그래서 "물었음" 플래그를 두지 않는다. 확인하면 항목을 업로드 대기 큐에 넣고 옛 목록을 비운다(파일은 큐가 쓴다).
 */
import type { QueuedVideo } from './upload-queue.ts';

export const LEGACY_ARCHIVE_KEY = 'acttub.archive.v1';

export type LegacyArchiveRecording = {
  id: string;
  uri: string;
  durationSec: number | null;
  createdAt: string;
  favorite: boolean;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

export async function readLegacyArchive(storage: Storage): Promise<LegacyArchiveRecording[]> {
  try {
    const raw = await storage.getItem(LEGACY_ARCHIVE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((r): r is LegacyArchiveRecording => !!r && typeof r === 'object' && typeof (r as LegacyArchiveRecording).uri === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function migrateLegacyArchive(deps: {
  storage: Storage;
  owner: string;
  enqueue: (entry: Omit<QueuedVideo, 'intentId' | 'intentExpiresAt' | 'status' | 'lastError'>) => Promise<unknown>;
  newRequestId: () => string;
  now?: () => number;
}): Promise<{ moved: number }> {
  const list = await readLegacyArchive(deps.storage);
  const at = (deps.now ?? Date.now)();
  let moved = 0;
  for (const rec of list) {
    await deps.enqueue({
      id: `legacy-${rec.id}`,
      owner: deps.owner,
      requestId: deps.newRequestId(),
      uri: rec.uri,
      contentType: 'video/mp4',
      durationMs: rec.durationSec ? rec.durationSec * 1000 : null,
      createdAt: at,
    });
    moved += 1;
  }
  await deps.storage.removeItem(LEGACY_ARCHIVE_KEY);
  return { moved };
}
