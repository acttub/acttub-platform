import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { unreadNotificationCount: jest.fn() } }));

const unread = api.unreadNotificationCount as jest.Mock;

function Host() {
  const { count, badge } = useUnreadNotifications();
  return <Text>{`${count}/${badge ?? '-'}`}</Text>;
}

let onChange: (state: string) => void;
let removed: boolean;
beforeEach(() => {
  removed = false;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (state: string) => void) => {
    onChange = handler;
    return { remove: () => { removed = true; } };
  }) as never);
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test('열 때 읽지 않은 묶음 수를 읽어 배지를 단다', async () => {
  unread.mockResolvedValue({ count: 3 });
  await render(<Host />);
  await flush();
  expect(screen.getByText('3/3')).toBeOnTheScreen();
});

test('99개가 넘으면 99+로 줄인다', async () => {
  unread.mockResolvedValue({ count: 120 });
  await render(<Host />);
  await flush();
  expect(screen.getByText('120/99+')).toBeOnTheScreen();
});

test('배경에서 돌아올 때만 다시 읽고, 실패하면 배지를 뗀다', async () => {
  unread.mockResolvedValue({ count: 2 });
  const view = await render(<Host />);
  await flush();
  expect(screen.getByText('2/2')).toBeOnTheScreen();

  unread.mockResolvedValue({ count: 5 });
  await act(async () => onChange('background'));
  await flush();
  expect(screen.getByText('2/2')).toBeOnTheScreen();

  await act(async () => onChange('active'));
  await flush();
  expect(screen.getByText('5/5')).toBeOnTheScreen();

  unread.mockRejectedValue(new Error('down'));
  await act(async () => onChange('active'));
  await flush();
  expect(screen.getByText('0/-')).toBeOnTheScreen();

  await view.unmount();
  expect(removed).toBe(true);
});

test('서버가 음수를 주면 0으로 본다', async () => {
  unread.mockResolvedValue({ count: -1 });
  await render(<Host />);
  await flush();
  expect(screen.getByText('0/-')).toBeOnTheScreen();
});

test('여러 화면이 같이 써도 한 번만 읽고, 같은 수를 보인다 (SOMA-829)', async () => {
  unread.mockClear();
  const addSpy = AppState.addEventListener as jest.Mock;
  addSpy.mockClear();
  let resolve: (value: { count: number }) => void = () => undefined;
  unread.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = await render(<><Host /><Host /><Host /></>);
  expect(unread).toHaveBeenCalledTimes(1);
  expect(addSpy).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ count: 4 }));
  await flush();
  expect(screen.getAllByText('4/4')).toHaveLength(3);

  unread.mockResolvedValue({ count: 6 });
  await act(async () => onChange('active'));
  await flush();
  expect(unread).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('6/6')).toHaveLength(3);
  await view.unmount();
  expect(removed).toBe(true);
});
