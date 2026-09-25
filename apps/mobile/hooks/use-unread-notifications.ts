import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { badgeText } from '@/lib/challenge/notification-center';

/**
 * 탭 배지(challenge.notification) — 읽지 않은 **묶음** 수다(사건 수가 아니다).
 *
 * 앱을 열 때와 배경에서 돌아올 때 읽는다. 실패하면 배지를 달지 않는다 — 배지 때문에 화면이
 * 멈추지 않는다. 챌린지가 열리지 않은 사람(게스트·한국어 아님)은 부르지 않는다.
 */
export function useUnreadNotifications(enabled: boolean): { count: number; badge: string | null; refresh: () => void } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    void api
      .unreadNotificationCount()
      .then((result) => setCount(Math.max(0, result.count)))
      .catch(() => setCount(0));
  }, [enabled]);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { count, badge: badgeText(count), refresh };
}
