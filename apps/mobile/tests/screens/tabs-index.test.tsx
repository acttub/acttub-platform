import { act, render } from '@testing-library/react-native';

import LastTabRedirect from '@/app/(tabs)/index';
import { logEvent } from '@/lib/analytics';
import { LAST_TAB_KEY, rememberLastTab, resetLastTabForTest } from '@/lib/last-tab';

/**
 * '/'(탭 index) — 홈 탭이 없어져 마지막에 쓴 탭으로 넘기는 길만 남았다(SOMA-1120).
 */

const ROUTES = ['index', 'reading', 'coaching', 'community', 'challenges', 'profile', 'history', 'record'].map((name) => ({ name, key: `${name}-k` }));
const mockNavigation = {
  getState: jest.fn(() => ({ key: 'tabs-k', index: 0, routes: ROUTES, routeNames: ROUTES.map((r) => r.name), history: [{ type: 'route', key: 'index-k' }], stale: false, type: 'tab' })),
  dispatch: jest.fn(),
};
const mockFocusEffects = new Set<() => void | (() => void)>();
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useNavigation: () => mockNavigation,
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        mockFocusEffects.add(effect);
        const cleanup = effect();
        return () => {
          mockFocusEffects.delete(effect);
          cleanup?.();
        };
      }, [effect]);
    },
  };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

// 기기 저장소 — 시험 환경의 AsyncStorage 목에는 default 가 없어 lib/device-storage 를 기억 속 저장소로 바꾼다.
const mockStore = new Map<string, string>();
jest.mock('@/lib/device-storage', () => ({
  deviceStorage: () => ({
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  }),
}));
const storage = { setItem: async (k: string, v: string) => void mockStore.set(k, v), removeItem: async (k: string) => void mockStore.delete(k) };

/** 넘긴 탭 — 탭 기록을 그 탭 하나로 다시 쓴 reset 이어야 한다. */
const resetTo = () => {
  const action = mockNavigation.dispatch.mock.calls.at(-1)?.[0];
  expect(action.type).toBe('RESET');
  expect(action.target).toBe('tabs-k');
  const state = action.payload;
  return { tab: state.routes[state.index].name, history: state.history };
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetLastTabForTest();
  await storage.removeItem(LAST_TAB_KEY);
});

test('처음 여는 기기는 리딩 탭을 열고 app_open_tab { restored: no } 를 남긴다', async () => {
  await render(<LastTabRedirect />);
  await act(async () => undefined);

  expect(resetTo()).toEqual({ tab: 'reading', history: [{ type: 'route', key: 'reading-k' }] });
  expect(logEvent).toHaveBeenCalledWith('app_open_tab', { tab: 'reading', restored: 'no' });
});

test('기기에 남은 마지막 탭을 되살려 열고 restored: yes 로 남긴다 — 다시 와도 이벤트는 한 번뿐이다', async () => {
  await storage.setItem(LAST_TAB_KEY, 'community');
  const view = await render(<LastTabRedirect />);
  await act(async () => undefined);

  expect(resetTo().tab).toBe('community');
  expect(logEvent).toHaveBeenCalledWith('app_open_tab', { tab: 'community', restored: 'yes' });

  // 「홈으로」(dismissTo('/(tabs)'))로 다시 오면 이번 실행에서 마지막에 본 탭으로 넘기고 이벤트는 남기지 않는다.
  await rememberLastTab('profile');
  await view.unmount();
  await render(<LastTabRedirect />);
  await act(async () => undefined);
  expect(resetTo().tab).toBe('profile');
  expect(logEvent).toHaveBeenCalledTimes(1);
});
