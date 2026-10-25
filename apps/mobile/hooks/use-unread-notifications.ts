import { useEffect, useState } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { api } from '@/lib/api';
import { badgeText } from '@/lib/challenge/notification-center';

/**
 * 탭 배지(challenge.notification) — 읽지 않은 **묶음** 수다(사건 수가 아니다).
 *
 * 앱을 열 때와 배경에서 돌아올 때 읽는다. 실패하면 배지를 달지 않는다 — 배지 때문에 화면이
 * 멈추지 않는다.
 *
 * 탭 레이아웃·홈·챌린지가 같은 수를 쓰므로 **한 벌**만 둔다(SOMA-829). 화면마다 따로 읽으면 앱을 열거나
 * 돌아올 때마다 같은 요청이 세 번씩 나가 계정 1분 요청 한도(SOMA-825)를 빨리 채운다. 이미 읽는 중이면
 * 그 응답을 같이 기다리고, 배경 복귀 구독도 쓰는 화면이 하나라도 있을 때 하나만 둔다.
 */
let sharedCount = 0;
let inflight: Promise<void> | null = null;
let users = 0;
let subscription: NativeEventSubscription | null = null;
const listeners = new Set<(count: number) => void>();

function publish(count: number) {
  sharedCount = count;
  listeners.forEach((listener) => listener(count));
}

function refreshShared(): Promise<void> {
  if (inflight) return inflight;
  const pending = api
    .unreadNotificationCount()
    .then((result) => publish(Math.max(0, result.count)))
    .catch(() => publish(0))
    .finally(() => {
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return pending;
}

export function useUnreadNotifications(): { count: number; badge: string | null } {
  const [count, setCount] = useState(sharedCount);

  useEffect(() => {
    listeners.add(setCount);
    users += 1;
    if (!subscription) {
      subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refreshShared();
      });
    }
    void refreshShared();
    return () => {
      listeners.delete(setCount);
      users -= 1;
      if (users === 0 && subscription) {
        subscription.remove();
        subscription = null;
      }
    };
  }, []);

  return { count, badge: badgeText(count) };
}
