import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

import { api } from '@/lib/api';
import { isHomeReady, subscribeHomeReady } from '@/lib/launch-splash';
import { prefetchCommunity, prefetchOtherTabs } from '@/lib/tab-prefetch';
import { scheduleTabWarmup, type WarmTab } from '@/lib/tab-warmup';

/**
 * 미리 만들어 둔 탭 목록. 탭 레이아웃이 이 탭들의 lazy 를 끈다 — 그러면 보이지 않는 채로 화면이 만들어진다(lib/tab-warmup).
 */
export function useWarmTabs(): ReadonlySet<WarmTab> {
  const [warm, setWarm] = useState<ReadonlySet<WarmTab>>(() => new Set());
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
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
        // 홈이 뜨면 곧바로 받는다 — 커뮤니티 목록, 리딩 이어 읽기 카드, 프로필 이번 달 숫자(lib/tab-prefetch).
        // 받은 답은 api 가 lib/last-reads 에 남기고, 탭은 마운트할 때 그것으로 바로 그린다.
        prefetchCommunity: () => prefetchCommunity(api),
        prefetchOthers: () => prefetchOtherTabs(api),
        homeShowing: () => pathnameRef.current === '/',
        warm: (tab) => setWarm((prev) => (prev.has(tab) ? prev : new Set([...prev, tab]))),
      }),
    [],
  );
  return warm;
}
