/**
 * 암기 상태 저장(reading.memorization). 갱신은 줄마다 즉시 보낸다. 실패(오프라인)하면 기기 값을 먼저 보여 주고
 * 토글 상태를 들고 있다가 다시 보낸다. 같은 상태를 다시 눌러도 보내지 않는다. 두 기기의 상반된 갱신은 마지막
 * 요청이 남는다(서버).
 */
import type { MemorizationEntry, MemorizationStatus } from "@/lib/reading/api-types";

export interface MemorizationSync {
  status(lineId: string): MemorizationStatus | null;
  /** 기기 값을 바로 바꾸고 서버에 보낸다. 실패해도 던지지 않는다. */
  set(lineId: string, status: MemorizationStatus): Promise<void>;
  /** 보내지 못한 것을 다시 보낸다. */
  flush(): Promise<void>;
  pending(): number;
  entries(): MemorizationEntry[];
}

export function createMemorizationSync(deps: {
  initial: MemorizationEntry[];
  send: (lineId: string, status: MemorizationStatus) => Promise<MemorizationEntry>;
}): MemorizationSync {
  const local = new Map<string, MemorizationEntry>(deps.initial.map((e) => [e.line_id, { ...e }]));
  const unsent = new Map<string, MemorizationStatus>();

  const push = async (lineId: string, status: MemorizationStatus) => {
    try {
      const saved = await deps.send(lineId, status);
      // 그 사이 다시 바뀌었으면 그 값이 다음 전송이다.
      if (unsent.get(lineId) === status) unsent.delete(lineId);
      if (local.get(lineId)?.status === status) local.set(lineId, saved);
    } catch {
      unsent.set(lineId, status);
    }
  };

  return {
    status: (lineId) => local.get(lineId)?.status ?? null,
    async set(lineId, status) {
      if (local.get(lineId)?.status === status && !unsent.has(lineId)) return;
      local.set(lineId, { line_id: lineId, status, updated_at: local.get(lineId)?.updated_at ?? "" });
      unsent.set(lineId, status);
      await push(lineId, status);
    },
    async flush() {
      for (const [lineId, status] of [...unsent]) await push(lineId, status);
    },
    pending: () => unsent.size,
    entries: () => [...local.values()],
  };
}
