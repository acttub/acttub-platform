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
  /** 다음 것을 미리 불러오느라 돌린 재생. */
  isPreload: boolean;
  /** 자동 반복(루프)으로 다시 처음부터 돈 재생. */
  isRepeat: boolean;
  /** 이 재생에서 이미 보냈다. */
  alreadySent: boolean;
};

export function shouldCountView(signal: ViewSignal): boolean {
  if (signal.alreadySent) return false;
  if (signal.isOwn || signal.isPreload || signal.isRepeat) return false;
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

export type EntryBucket = 'under_review' | 'private' | 'public';

/**
 * 참여작 하나는 **한 분류에만** 든다. 우선순위는 확인 중(신고 숨김이거나 부모 챌린지가
 * 검토·숨김) → 비공개 → 공개다. 그래서 비공개이면서 신고 숨김인 참여작은 확인 중에만 센다.
 */
export function bucketOf(
  entry: Pick<MyEntryCard, 'status' | 'visibility' | 'challenge_hidden'>,
): EntryBucket {
  if (entry.status === 'hidden_by_report' || entry.challenge_hidden) return 'under_review';
  return entry.visibility === 'private' ? 'private' : 'public';
}

export type EntryCounts = { all: number; public: number; private: number; under_review: number };

/** 전체는 셋의 합이다. 삭제된 참여작은 세지 않는다. */
export function entryCounts(
  entries: readonly Pick<MyEntryCard, 'status' | 'visibility' | 'challenge_hidden'>[],
): EntryCounts {
  const counts: EntryCounts = { all: 0, public: 0, private: 0, under_review: 0 };
  for (const entry of entries) {
    if (entry.status === 'deleted') continue;
    counts[bucketOf(entry)] += 1;
  }
  counts.all = counts.public + counts.private + counts.under_review;
  return counts;
}

/** 카드 오른쪽에 붙는 상태 — 비공개는 "비공개 저장", 확인 중은 "확인 중", 공개는 조회·좋아요다. */
export function entryStatusLabel(
  entry: Pick<MyEntryCard, 'status' | 'visibility' | 'challenge_hidden' | 'view_count' | 'like_count'>,
): string {
  const bucket = bucketOf(entry);
  if (bucket === 'under_review') return translate('challengeEntries.underReview');
  if (bucket === 'private') return translate('challengeEntries.privateSaved');
  return translate('challengeEntries.publicStat', { views: entry.view_count, likes: entry.like_count });
}
