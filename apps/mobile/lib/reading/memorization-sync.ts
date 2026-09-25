/**
 * 암기 상태 저장(reading.memorization). 갱신은 줄마다 즉시 서버에 보내고 조회는 대본 단위로 한 번에 받는다.
 * 실패(오프라인)하면 기기 값을 먼저 보여 주고 토글 상태를 들고 있다가 다시 보낸다 — 앱을 다시 열어도 남도록
 * 저장소에 둔다. 같은 상태를 다시 눌러도 보내지 않는다(서버도 updated_at 을 바꾸지 않는다). 두 기기의 상반된 갱신은
 * 마지막 요청이 남는다(서버).
 */
import type { LineMemorization, MemorizationStatus } from './types.ts';

export const MEMORIZATION_QUEUE_KEY = 'acttub.reading.memorizationQueue';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type MemorizationSyncDependencies = {
  storage: Storage;
  send: (lineId: string, status: MemorizationStatus) => Promise<LineMemorization>;
  /** 서버가 준 목록. 미전송 값이 있으면 그것이 우선이다(restore). */
  initial: LineMemorization[];
  onChange?: () => void;
};

export function createMemorizationSync(deps: MemorizationSyncDependencies) {
  const local = new Map<string, LineMemorization>(deps.initial.map((e) => [e.line_id, { ...e }]));
  const unsent = new Map<string, MemorizationStatus>();

  async function readUnsent(): Promise<Record<string, MemorizationStatus>> {
    try {
      const raw = await deps.storage.getItem(MEMORIZATION_QUEUE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, MemorizationStatus>) : {};
    } catch {
      return {};
    }
  }

  async function writeUnsent(): Promise<void> {
    try {
      const all = await readUnsent();
      // 이 대본의 값만 갈아 끼우고 다른 대본의 미전송 값은 남긴다.
      for (const [lineId, status] of unsent) all[lineId] = status;
      for (const lineId of Object.keys(all)) if (local.has(lineId) && !unsent.has(lineId)) delete all[lineId];
      if (Object.keys(all).length === 0) await deps.storage.removeItem(MEMORIZATION_QUEUE_KEY);
      else await deps.storage.setItem(MEMORIZATION_QUEUE_KEY, JSON.stringify(all));
    } catch {}
  }

  async function push(lineId: string, status: MemorizationStatus): Promise<void> {
    try {
      const saved = await deps.send(lineId, status);
      if (unsent.get(lineId) === status) unsent.delete(lineId);
      if (local.get(lineId)?.status === status) local.set(lineId, saved);
    } catch {
      unsent.set(lineId, status);
    }
    await writeUnsent();
    deps.onChange?.();
  }

  return {
    status(lineId: string): MemorizationStatus | null {
      return local.get(lineId)?.status ?? null;
    },
    entries(): LineMemorization[] {
      return [...local.values()];
    },
    pending(): number {
      return unsent.size;
    },
    /** 저장소에 남은 미전송 값을 기기 값으로 올린다(앱을 다시 열었을 때). 서버 값보다 우선이다. */
    async restore(): Promise<void> {
      const stored = await readUnsent();
      for (const [lineId, status] of Object.entries(stored)) {
        unsent.set(lineId, status);
        local.set(lineId, { line_id: lineId, status, updated_at: local.get(lineId)?.updated_at ?? '' });
      }
      deps.onChange?.();
    },
    /** 기기 값을 바로 바꾸고 서버에 보낸다. 실패해도 던지지 않는다. */
    async set(lineId: string, status: MemorizationStatus): Promise<void> {
      if (local.get(lineId)?.status === status && !unsent.has(lineId)) return;
      local.set(lineId, { line_id: lineId, status, updated_at: local.get(lineId)?.updated_at ?? '' });
      unsent.set(lineId, status);
      deps.onChange?.();
      await push(lineId, status);
    },
    /** 보내지 못한 것을 다시 보낸다. */
    async flush(): Promise<void> {
      for (const [lineId, status] of [...unsent]) await push(lineId, status);
    },
  };
}

export type MemorizationSync = ReturnType<typeof createMemorizationSync>;
