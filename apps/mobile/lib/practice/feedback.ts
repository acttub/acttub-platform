import type { FeedbackBody } from './types.ts';

/**
 * 이탈 설문(practice.feedback)의 밀린 접수. 설문 화면은 SOMA-494에서 걷었고, 그 전에 기기에
 * 밀려 있던 접수를 마저 보내는 일만 남았다. 접수는 서버가 정본이다.
 */
const PENDING_KEY = 'acttub.feedback.pending';

// ─── 밀린 제출 ────────────────────────────────────────────────────────────────

export type FeedbackStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type FeedbackQueueDeps = {
  storage: FeedbackStorage;
  submit: (body: FeedbackBody) => Promise<unknown>;
};

function isPermanent(error: unknown): boolean {
  const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : null;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function readPending(storage: FeedbackStorage): Promise<FeedbackBody[]> {
  try {
    const raw = await storage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as FeedbackBody[]) : [];
  } catch {
    return [];
  }
}

async function writePending(storage: FeedbackStorage, bodies: FeedbackBody[]): Promise<void> {
  try {
    if (bodies.length === 0) await storage.removeItem(PENDING_KEY);
    else await storage.setItem(PENDING_KEY, JSON.stringify(bodies));
  } catch {
    // 못 적어도 나가기를 막지 않는다.
  }
}

/**
 * 밀린 접수를 다시 보낸다. 같은 요청 id 라 서버에는 행이 하나다.
 * 4xx(형식 오류 등)는 들고 있어도 소용없어 버린다.
 */
export function createFeedbackQueue(dependencies: FeedbackQueueDeps) {
  const { storage, submit } = dependencies;

  async function flush(): Promise<{ sent: number; kept: number }> {
    const pending = await readPending(storage);
    if (pending.length === 0) return { sent: 0, kept: 0 };
    const keep: FeedbackBody[] = [];
    let sent = 0;
    for (const body of pending) {
      try {
        await submit(body);
        sent += 1;
      } catch (error) {
        if (!isPermanent(error)) keep.push(body);
      }
    }
    await writePending(storage, keep);
    return { sent, kept: keep.length };
  }

  return { flush };
}

export const FEEDBACK_PENDING_KEY = PENDING_KEY;
