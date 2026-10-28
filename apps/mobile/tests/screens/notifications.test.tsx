import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import NotificationsScreen from '@/app/notifications';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { NotificationGroup } from '@/lib/challenge/types';
import { loadNotificationSettings } from '@/lib/notifications';

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('@/lib/api', () => ({ api: { listNotifications: jest.fn(), readNotifications: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ loadNotificationSettings: jest.fn() }));

const listNotifications = api.listNotifications as jest.Mock;
const readNotifications = api.readNotifications as jest.Mock;
const loadSettings = loadNotificationSettings as jest.Mock;

function group(overrides: Partial<NotificationGroup>): NotificationGroup {
  return {
    group_key: 'g1',
    kind: 'entry_liked',
    actor_count: 1,
    event_count: 1,
    actor_name: '윤서',
    challenge_id: 'c1',
    entry_id: 'e1',
    comment_id: null,
    comment_excerpt: null,
    latest_at: new Date().toISOString(),
    read: false,
    target_available: true,
    ...overrides,
  };
}

const liked = group({ group_key: 'g-like', kind: 'entry_liked', actor_count: 3, latest_at: '2026-10-20T10:00:00Z' });
const commented = group({ group_key: 'g-cmt', kind: 'entry_commented', actor_count: 2, latest_at: '2026-10-19T10:00:00Z' });

beforeEach(() => {
  jest.clearAllMocks();
  readNotifications.mockResolvedValue(undefined);
  loadSettings.mockResolvedValue({ challenge: true });
});

test('묶음을 최신 순으로 보여 주고 보관 기간을 알린다', async () => {
  listNotifications.mockResolvedValue({ groups: [commented, liked], next_cursor: null });
  await render(<NotificationsScreen />);

  await screen.findByText('3명이 좋아해요');
  expect(screen.getAllByText(/3명이 좋아해요|댓글 2개가 달렸어요/).map((n) => n.props.children)).toEqual([
    '3명이 좋아해요',
    '댓글 2개가 달렸어요',
  ]);
  expect(screen.getByText('알림은 90일 동안 보관해요.')).toBeOnTheScreen();
  expect(screen.queryByText('챌린지 알림이 꺼져 있어요. 여기에는 계속 쌓여요.')).not.toBeOnTheScreen();
});

test('챌린지 알림을 꺼 두었으면 머리에 알린다', async () => {
  listNotifications.mockResolvedValue({ groups: [], next_cursor: null });
  loadSettings.mockResolvedValue({ challenge: false });
  await render(<NotificationsScreen />);

  expect(await screen.findByText('챌린지 알림이 꺼져 있어요. 여기에는 계속 쌓여요.')).toBeOnTheScreen();
  expect(screen.getByText('아직 알림이 없어요.')).toBeOnTheScreen();
});

test('목록을 못 불러오면 실패 문구만 보여 준다', async () => {
  listNotifications.mockRejectedValue(new Error('down'));
  loadSettings.mockRejectedValue(new Error('down'));
  await render(<NotificationsScreen />);

  expect(await screen.findByText('알림을 불러오지 못했어요.')).toBeOnTheScreen();
  expect(screen.queryByText('아직 알림이 없어요.')).not.toBeOnTheScreen();
});

test.each([
  [
    '좋아요 묶음은 그 참여작을 재생한다',
    group({ group_key: 'k', kind: 'entry_liked', challenge_id: 'c1', entry_id: 'e1' }),
    { pathname: '/challenge-play', params: { id: 'c1', entryId: 'e1' } },
    'entry',
  ],
  [
    '종료 알림은 챌린지 상세를 연다',
    group({ group_key: 'k', kind: 'challenge_ended', challenge_id: 'c2', actor_name: null }),
    { pathname: '/challenge-detail', params: { id: 'c2' } },
    'challenge',
  ],
])('%s', async (_name, item, route, targetKind) => {
  listNotifications.mockResolvedValue({ groups: [item], next_cursor: null });
  await render(<NotificationsScreen />);

  const row = await screen.findAllByRole('button');
  await fireEvent.press(row[row.length - 1]);

  expect(readNotifications).toHaveBeenCalledWith({ group_keys: ['k'] });
  expect(logEvent).toHaveBeenCalledWith('notification_open', { kind: item.kind, target: targetKind });
  expect(mockRouter.push).toHaveBeenCalledWith(route);
});

test('대상을 볼 수 없으면 이동하지 않고 볼 수 없다고 알린다', async () => {
  listNotifications.mockResolvedValue({
    groups: [group({ group_key: 'k', kind: 'entry_commented', target_available: false })],
    next_cursor: null,
  });
  readNotifications.mockRejectedValue(new Error('down'));
  await render(<NotificationsScreen />);

  await fireEvent.press(await screen.findByText('댓글 1개가 달렸어요'));

  expect(await screen.findByText('볼 수 없는 영상이에요.')).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(readNotifications).toHaveBeenCalledWith({ group_keys: ['k'] });
});

test('내 참여작이 운영 확인 중이라 숨겨졌으면 그 이유로 알린다', async () => {
  listNotifications.mockResolvedValue({
    groups: [group({ group_key: 'k', target_available: false, target_hidden: true })],
    next_cursor: null,
  });
  readNotifications.mockResolvedValue(undefined);
  await render(<NotificationsScreen />);

  await fireEvent.press(await screen.findByText('1명이 좋아해요'));

  expect(await screen.findByText('운영 확인 중이라 지금은 볼 수 없는 영상이에요.')).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('모두 읽음은 가장 최신 묶음까지를 읽음으로 보낸다', async () => {
  listNotifications.mockResolvedValue({ groups: [commented, liked], next_cursor: null });
  readNotifications.mockRejectedValue(new Error('down'));
  await render(<NotificationsScreen />);
  await screen.findByText('3명이 좋아해요');

  await fireEvent.press(screen.getByRole('button', { name: '모두 읽음' }));

  expect(readNotifications).toHaveBeenCalledWith({
    all_before: { created_at: '2026-10-20T10:00:00Z', id: 'g-like' },
  });
});

test('알림이 없으면 모두 읽음은 아무것도 보내지 않는다', async () => {
  listNotifications.mockResolvedValue({ groups: [], next_cursor: null });
  await render(<NotificationsScreen />);
  await screen.findByText('아직 알림이 없어요.');

  await fireEvent.press(screen.getByRole('button', { name: '모두 읽음' }));
  expect(readNotifications).not.toHaveBeenCalled();
  expect(screen.getByText('아직 알림이 없어요.')).toBeOnTheScreen();
});

test('끝까지 내리면 다음 묶음을 이어 붙이고, 더 없으면 묻지 않는다', async () => {
  listNotifications
    .mockResolvedValueOnce({ groups: [liked], next_cursor: 'cur-2' })
    .mockResolvedValueOnce({ groups: [commented], next_cursor: null });
  await render(<NotificationsScreen />);
  const first = await screen.findByText('3명이 좋아해요');

  await fireEvent(first, 'momentumScrollEnd');
  expect(await screen.findByText('댓글 2개가 달렸어요')).toBeOnTheScreen();
  expect(listNotifications).toHaveBeenLastCalledWith('cur-2');

  await fireEvent(first, 'momentumScrollEnd');
  expect(listNotifications).toHaveBeenCalledTimes(2);
});

test('다음 묶음을 못 받으면 있던 목록을 그대로 둔다', async () => {
  listNotifications
    .mockResolvedValueOnce({ groups: [liked], next_cursor: 'cur-2' })
    .mockRejectedValueOnce(new Error('down'));
  await render(<NotificationsScreen />);
  const first = await screen.findByText('3명이 좋아해요');

  await fireEvent(first, 'momentumScrollEnd');
  await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(2));
  expect(screen.getByText('3명이 좋아해요')).toBeOnTheScreen();
  expect(screen.queryByText('알림을 불러오지 못했어요.')).not.toBeOnTheScreen();
});

test('뒤로 버튼은 이전 화면으로 돌아간다', async () => {
  listNotifications.mockResolvedValue({ groups: [], next_cursor: null });
  await render(<NotificationsScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  await screen.findByText('아직 알림이 없어요.');
});
