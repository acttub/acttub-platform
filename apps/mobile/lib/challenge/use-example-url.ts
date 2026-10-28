import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { loadExampleUrl } from '@/lib/challenge/example-pick';
import type { ChallengeCard } from '@/lib/challenge/types';

/**
 * 이번 주 대사 카드에 틀어 줄 참여작 예시 영상 주소(SOMA-920).
 * 지난주 선정작을 먼저 쓰고, 없으면 이번 주 좋아요 순 첫 재생 가능 참여작. 없으면 null.
 * `refreshKey`가 바뀌면(예: 이번 주 참여작 수) 다시 고른다.
 */
export function useExampleUrl(featuredId: string | null, refreshKey?: unknown): string | null {
  const [exampleUrl, setExampleUrl] = useState<string | null>(null);
  useEffect(() => {
    setExampleUrl(null);
    if (!featuredId) return;
    let alive = true;
    void api
      .listChallenges({ tab: 'ended' })
      .then((r) => r.challenges)
      .catch(() => [] as ChallengeCard[])
      .then((ended) =>
        loadExampleUrl({ ended, featuredId, listEntries: (id) => api.listChallengeEntries(id, { sort: 'likes' }) }),
      )
      .then((url) => alive && setExampleUrl(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [featuredId, refreshKey]);
  return exampleUrl;
}
