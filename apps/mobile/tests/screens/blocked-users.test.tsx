import { fireEvent, render, screen } from '@testing-library/react-native';

import BlockedUsersScreen from '@/app/blocked-users';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { listBlocks: jest.fn(), blockUser: jest.fn() } }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: jest.fn() }) }));

const listBlocks = api.listBlocks as jest.Mock;
const blockUser = api.blockUser as jest.Mock;

test('차단한 사람을 보여 주고 풀면 목록에서 빠진다', async () => {
  listBlocks.mockResolvedValue({ users: [{ user_id: 'u1', name: '민지' }] });
  blockUser.mockResolvedValue(undefined);

  await render(<BlockedUsersScreen />);
  expect(await screen.findByText('민지')).toBeOnTheScreen();

  fireEvent.press(screen.getByText('차단 풀기'));

  expect(await screen.findByText('차단을 풀었어요.')).toBeOnTheScreen();
  expect(blockUser).toHaveBeenCalledWith('u1', false);
  expect(screen.queryByText('민지')).not.toBeOnTheScreen();
});

test('목록을 못 불러오면 오류 문구를 보여 준다', async () => {
  listBlocks.mockRejectedValue(new Error('down'));
  await render(<BlockedUsersScreen />);
  expect(await screen.findByText('차단 목록을 불러오지 못했어요.')).toBeOnTheScreen();
});
