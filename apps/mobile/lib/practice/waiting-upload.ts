import type { SceneDraft, BlockageDraft } from './start.ts';

/**
 * 「홈에서 기다리기」(SOMA-817, pen 「② 일반 홈 · 영상 올리는 중」·「⑧ 새 연습 · 영상 올리는 중」).
 *
 * 영상을 올리는 동안 새 연습 화면을 떠나도 홈 맨 위 카드가 진행을 보이고, 다 올라가면 거기서 코칭을 시작한다.
 * 업로드 자체는 보관함 큐(lib/library/library-runner)가 화면과 따로 돌린다 — 여기는 "올리는 중인 영상으로 코칭을
 * 시작하려던 뜻"(장면·막힘·이어하기 정보)만 기기에 남긴다. 상태는 큐 항목과 확정된 영상 id 에서 매번 계산한다.
 */
export type WaitingUpload = {
  owner: string;
  /** 보관함 큐 항목 id */
  pendingId: string;
  /** 확정되면 채운다 — 큐의 확정 목록은 앱을 다시 켜면 사라지므로 따로 남긴다. */
  videoId: string | null;
  /** 같은 시작의 재시도는 같은 요청 id 라 회차가 하나만 생긴다. */
  requestId: string;
  continueFrom: { rootId: string; practiceId: string } | null;
  scene: SceneDraft;
  blockage: BlockageDraft;
  savedAt: number;
};

export type WaitingState = 'uploading' | 'ready' | 'failed' | 'gone';

export function waitingState(
  waiting: Pick<WaitingUpload, 'videoId'>,
  entry: { status: 'queued' | 'uploading' | 'failed' } | null,
  confirmedVideoId: string | null,
): WaitingState {
  if (waiting.videoId || confirmedVideoId) return 'ready';
  if (!entry) return 'gone';
  return entry.status === 'failed' ? 'failed' : 'uploading';
}

export type WaitingStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const KEY_PREFIX = 'acttub.waitingUpload:';

function isWaiting(value: unknown): value is WaitingUpload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<WaitingUpload>;
  return (
    typeof v.owner === 'string' &&
    typeof v.pendingId === 'string' &&
    typeof v.requestId === 'string' &&
    (v.videoId === null || typeof v.videoId === 'string') &&
    typeof v.scene === 'object' &&
    v.scene !== null &&
    typeof v.blockage === 'object' &&
    v.blockage !== null
  );
}

export function createWaitingUploadStore(storage: WaitingStorage) {
  const key = (owner: string) => KEY_PREFIX + encodeURIComponent(owner);
  return {
    async save(waiting: WaitingUpload): Promise<void> {
      await storage.setItem(key(waiting.owner), JSON.stringify(waiting));
    },
    async load(owner: string): Promise<WaitingUpload | null> {
      const raw = await storage.getItem(key(owner));
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isWaiting(parsed) && parsed.owner === owner) return parsed;
      } catch {
        // 깨진 기록은 버린다
      }
      await storage.removeItem(key(owner));
      return null;
    },
    async clear(owner: string): Promise<void> {
      await storage.removeItem(key(owner));
    },
  };
}
