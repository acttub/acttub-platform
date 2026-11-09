import type { DeviceStorage } from './device-storage.ts';

/** 저장소 한 칸에 JSON 배열로 남기는 큐 목록. 깨졌거나 배열이 아니면 빈 목록으로 본다. 비면 칸을 지운다. */
export function storedList<T>(storage: DeviceStorage, key: string, onChange?: () => void) {
  return {
    async read(): Promise<T[]> {
      try {
        const raw = await storage.getItem(key);
        const list = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(list) ? (list as T[]) : [];
      } catch {
        return [];
      }
    },
    async write(list: T[]): Promise<void> {
      if (list.length === 0) await storage.removeItem(key);
      else await storage.setItem(key, JSON.stringify(list));
      onChange?.();
    },
  };
}

/**
 * `cutoff` 보다 먼저 들어온 항목(`match`가 고른 것만)의 기기 파일을 지우고 목록에서 뺀다. 경계 시각과 같으면 남긴다.
 * 파일 지우기 실패는 무시한다 — 목록에서는 뺀다.
 */
export async function dropStale<T extends { createdAt: number; uri: string }>(
  list: T[],
  cutoff: number,
  deleteFile: (uri: string) => Promise<void>,
  match: (entry: T) => boolean = () => true,
): Promise<{ stale: T[]; fresh: T[] }> {
  const stale = list.filter((e) => match(e) && e.createdAt < cutoff);
  if (stale.length > 0) await Promise.allSettled(stale.map((e) => deleteFile(e.uri)));
  return { stale, fresh: list.filter((e) => !stale.includes(e)) };
}
