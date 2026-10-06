import type { MyEntryCard } from './types.ts';
import { translate } from '../i18n.ts';

/**
 * 조회수 사건과 내 참여작 분류(challenge.browse).
 *
 * 조회수는 참여작 영상이 3초 이상 재생된 사건마다 1 더한다. 본인 재생·미리 불러오기·자동 반복은
 * 세지 않는다. 사건 id 로 같은 사건이 두 번 반영되지 않게 하고, 보내기가 실패해도 재생은 그대로다.
 */
export const VIEW_THRESHOLD_MS = 3_000;

export type ViewSignal = {
  elapsedMs: number;
  /** 본인 참여작을 본 것. */
  isOwn: boolean;
  /** 자동 반복(루프)으로 다시 처음부터 돈 재생. */
  isRepeat: boolean;
  /** 이 재생에서 이미 보냈다. */
  alreadySent: boolean;
};

export function shouldCountView(signal: ViewSignal): boolean {
  if (signal.alreadySent) return false;
  if (signal.isOwn || signal.isRepeat) return false;
  return signal.elapsedMs >= VIEW_THRESHOLD_MS;
}

export type ViewTrackerDeps = {
  send: (entryId: string, eventId: string) => Promise<unknown>;
  newEventId: () => string;
};

/**
 * 한 재생에 한 번만 사건을 보낸다. 다음 참여작으로 넘어가면(또는 같은 것을 다시 열면) 새 재생이다.
 * 보내기 실패는 삼킨다 — 조회수 때문에 재생을 막지 않는다.
 */
export function createViewTracker(dependencies: ViewTrackerDeps) {
  const sent = new Set<string>();

  /** 재생이 진행될 때마다 부른다. 조건을 채우면 한 번만 보낸다. */
  async function onProgress(entryId: string, signal: Omit<ViewSignal, 'alreadySent'>): Promise<boolean> {
    if (!shouldCountView({ ...signal, alreadySent: sent.has(entryId) })) return false;
    sent.add(entryId);
    try {
      await dependencies.send(entryId, dependencies.newEventId());
      return true;
    } catch {
      // 조회수 요청이 실패해도 재생은 된다.
      return false;
    }
  }

  /** 그 참여작을 떠났다 — 다음에 다시 열면 새 재생이다. */
  function leave(entryId: string): void {
    sent.delete(entryId);
  }

  return { onProgress, leave };
}

// ─── P03 내 참여작 분류 ───────────────────────────────────────────────────────

/** 분류는 서버가 매긴다(`category`) — 확인 중 → 비공개 → 공개 순으로 한 곳에만 든다. 분류별 수도 서버가 센다. */
export type EntryBucket = MyEntryCard['category'];

/** 카드 오른쪽에 붙는 상태 — 비공개는 "비공개 저장", 확인 중은 "확인 중", 공개는 조회·좋아요다. */
export function entryStatusLabel(entry: Pick<MyEntryCard, 'category' | 'view_count' | 'like_count'>): string {
  const bucket = entry.category;
  if (bucket === 'under_review') return translate('challengeEntries.underReview');
  if (bucket === 'private') return translate('challengeEntries.privateSaved');
  return translate('challengeEntries.publicStat', { views: entry.view_count, likes: entry.like_count });
}
