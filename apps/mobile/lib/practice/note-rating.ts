import type { NoteRatingBody } from './types.ts';

/**
 * 연습 노트 평가(practice.note) — "도움 됐어요·아쉬웠어요" 를 누르는 순간 서버에 노트 단위로 남긴다.
 * 한 줄은 선택이고 같은 평가에 덧붙는다(같은 노트에 다시 보내면 서버가 덮어쓴다).
 *
 * 누를 때마다 새 요청 id 를 만들고, 못 보낸 요청은 기기가 그 id 그대로 들고 있다가 다시 보낸다 —
 * 서버는 같은 id·같은 본문을 같은 답으로 받는다. 대기열은 노트(회차)마다 마지막 요청 하나만 들고 있다:
 * 옛 요청이 나중에 도착해 새 평가를 덮지 않게 하려는 것이다. 이탈 설문의 대기열(feedback.ts)과 같은 꼴이다.
 */
const PENDING_KEY = 'acttub.noteRating.pending';

export const NOTE_RATING_COMMENT_MAX = 100;
export const NOTE_RATING_PENDING_KEY = PENDING_KEY;

/** 앞뒤 공백을 걷은 한 줄. 비었으면 null(보내지 않는다). */
export function noteRatingCommentText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function buildNoteRatingBody(input: {
  requestId: string;
  rating: NoteRatingBody['rating'];
  /** 빼거나 비우면 서버가 한 줄을 비운다. */
  comment?: string | null;
}): NoteRatingBody {
  const body: NoteRatingBody = { request_id: input.requestId, rating: input.rating };
  const comment = noteRatingCommentText(input.comment);
  if (comment !== null) body.comment = comment;
  return body;
}

// ─── 밀린 평가 ────────────────────────────────────────────────────────────────

export type NoteRatingStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type NoteRatingQueueDeps<Body = NoteRatingBody> = {
  storage: NoteRatingStorage;
  submit: (practiceId: string, body: Body) => Promise<unknown>;
  /** 밀린 요청을 적어 두는 자리. 리딩 평가(reading.session)가 같은 대기열을 다른 자리로 쓴다. */
  pendingKey?: string;
};

type PendingRating<Body = NoteRatingBody> = { practice_id: string; body: Body };

function isPermanent(error: unknown): boolean {
  const status = error !== null && typeof error === 'object' ? (error as { status?: unknown }).status : null;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function readPending<Body>(storage: NoteRatingStorage, key: string): Promise<PendingRating<Body>[]> {
  try {
    const raw = await storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as PendingRating<Body>[]) : [];
  } catch {
    return [];
  }
}

async function writePending<Body>(storage: NoteRatingStorage, key: string, items: PendingRating<Body>[]): Promise<void> {
  try {
    if (items.length === 0) await storage.removeItem(key);
    else await storage.setItem(key, JSON.stringify(items));
  } catch {
    // 못 적어도 화면을 막지 않는다.
  }
}

/**
 * 보내고, 네트워크·서버 실패면 들고 있다가 다음에 다시 보낸다. 4xx(노트 없음·지문 불일치·형식 오류·탈퇴)는
 * 들고 있어도 소용없어 버린다.
 */
export function createNoteRatingQueue<Body = NoteRatingBody>(dependencies: NoteRatingQueueDeps<Body>) {
  const { storage, submit } = dependencies;
  const key = dependencies.pendingKey ?? PENDING_KEY;

  async function forget(practiceId: string): Promise<void> {
    const items = await readPending<Body>(storage, key);
    const rest = items.filter((item) => item.practice_id !== practiceId);
    if (rest.length !== items.length) await writePending(storage, key, rest);
  }

  async function send(practiceId: string, body: Body): Promise<'sent' | 'queued' | 'dropped'> {
    try {
      await submit(practiceId, body);
      // 새 평가가 반영됐으니 그 노트에 밀려 있던 옛 요청은 보내면 안 된다.
      await forget(practiceId);
      return 'sent';
    } catch (error) {
      if (isPermanent(error)) {
        await forget(practiceId);
        return 'dropped';
      }
      const items = (await readPending<Body>(storage, key)).filter((item) => item.practice_id !== practiceId);
      items.push({ practice_id: practiceId, body });
      await writePending(storage, key, items);
      return 'queued';
    }
  }

  async function flush(): Promise<{ sent: number; kept: number }> {
    const items = await readPending<Body>(storage, key);
    if (items.length === 0) return { sent: 0, kept: 0 };
    const keep: PendingRating<Body>[] = [];
    let sent = 0;
    for (const item of items) {
      try {
        await submit(item.practice_id, item.body);
        sent += 1;
      } catch (error) {
        if (!isPermanent(error)) keep.push(item);
      }
    }
    await writePending(storage, key, keep);
    return { sent, kept: keep.length };
  }

  return { send, flush };
}
