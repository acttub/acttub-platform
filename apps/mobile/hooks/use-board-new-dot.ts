import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { hasNewSince } from '@/lib/community';
import { boardSeenAt, markBoardSeen } from '@/lib/community-seen';

/**
 * 「게시판」 옆 빨간 점(SOMA-873) — 탭에 들어올 때 최신 글 하나의 시각을 기기에 적어 둔 본 시각과 비교한다.
 * 게시판을 열어 목록을 받으면 `markSeen`으로 그 목록의 가장 최근 글 시각을 적고 점을 끈다. 못 읽으면 점이 없다.
 */
export function useBoardNewDot(): { hasNew: boolean; markSeen: (latestCreatedAt: string | null | undefined) => void } {
  const [hasNew, setHasNew] = useState(false);
  /** 이 화면에서 방금 본 최신 글 시각 — 늦게 온 확인 결과가 꺼 둔 점을 다시 켜지 않게 한다. */
  const seenHere = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void Promise.all([
        Promise.resolve()
          .then(() => api.communityPosts())
          .then((r) => r.posts[0]?.created_at ?? null)
          .catch(() => null),
        boardSeenAt(),
      ]).then(([latest, seen]) => {
        if (live) setHasNew(hasNewSince(latest, seen) && hasNewSince(latest, seenHere.current));
      });
      return () => {
        live = false;
      };
    }, []),
  );

  const markSeen = useCallback((latestCreatedAt: string | null | undefined) => {
    setHasNew(false);
    if (!latestCreatedAt) return;
    seenHere.current = latestCreatedAt;
    void markBoardSeen(latestCreatedAt);
  }, []);

  return { hasNew, markSeen };
}
