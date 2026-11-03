import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { api } from '@/lib/api';
import { isHomeReady, subscribeHomeReady } from '@/lib/launch-splash';
import { scheduleTabWarmup, type WarmTab } from '@/lib/tab-warmup';

/**
 * 미리 만들어 둔 탭 목록. 탭 레이아웃이 이 탭들의 lazy 를 끈다 — 그러면 보이지 않는 채로 화면이 만들어진다(lib/tab-warmup).
 */
export function useWarmTabs(): ReadonlySet<WarmTab> {
  const [warm, setWarm] = useState<ReadonlySet<WarmTab>>(() => new Set());
  useEffect(
    () =>
      scheduleTabWarmup({
        onHomeReady: (listener) => {
          if (isHomeReady()) {
            listener();
            return () => undefined;
          }
          return subscribeHomeReady(listener);
        },
        afterInteractions: (task) => InteractionManager.runAfterInteractions(task),
        wait: (ms, task) => {
          const timer = setTimeout(task, ms);
          return () => clearTimeout(timer);
        },
        // 커뮤니티 첫 화면의 인기 목록과 지난주 결과 띠. 받은 답은 api 가 lib/last-reads 에 남긴다.
        prefetchCommunity: () =>
          Promise.allSettled([api.listChallenges({ tab: 'popular' }), api.listChallenges({ tab: 'ended' })]),
        warm: (tab) => setWarm((prev) => (prev.has(tab) ? prev : new Set([...prev, tab]))),
      }),
    [],
  );
  return warm;
}
