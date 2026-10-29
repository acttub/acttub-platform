import { fireEvent, render, screen } from '@testing-library/react-native';

import BlockedUsersScreen from '@/app/blocked-users';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { listBlocks: jest.fn(), blockUser: jest.fn() } }));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack }) }));

const listBlocks = api.listBlocks as jest.Mock;
const blockUser = api.blockUser as jest.Mock;

test('차단한 사람을 보여 주고 풀면 목록에서 빠진다', async () => {
  listBlocks.mockResolvedValue({ users: [{ user_id: 'u1', name: '민지' }] });
  blockUser.mockResolvedValue(undefined);

  await render(<BlockedUsersScreen />);
  expect(await screen.findByText('민지')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('차단 풀기'));

  expect(await screen.findByText('차단을 풀었어요')).toBeOnTheScreen();
  expect(blockUser).toHaveBeenCalledWith('u1', false);
  expect(screen.queryByText('민지')).not.toBeOnTheScreen();
});

test('목록을 못 불러오면 오류 상자를 보이고, 다시 시도하면 다시 받는다', async () => {
  listBlocks.mockRejectedValue(new Error('down'));
  await render(<BlockedUsersScreen />);
  expect(await screen.findByText('차단 목록을 불러오지 못했어요')).toBeOnTheScreen();

  listBlocks.mockResolvedValue({ users: [{ user_id: 'u1', name: '민지' }] });
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('민지')).toBeOnTheScreen();
});

test('차단 풀기가 실패하면 이유를 알리고 목록에 남긴다', async () => {
  listBlocks.mockResolvedValue({ users: [{ user_id: 'u1', name: '민지' }] });
  blockUser.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));

  await render(<BlockedUsersScreen />);
  await fireEvent.press(await screen.findByText('차단 풀기'));

  expect(await screen.findByText('차단을 풀지 못했어요')).toBeOnTheScreen();
  expect(screen.getByText('없는 사용자예요.')).toBeOnTheScreen();
  expect(screen.getByText('민지')).toBeOnTheScreen();
});

test('차단한 사람이 없으면 빈 안내를 보이고, 뒤로 버튼은 이전 화면으로 간다', async () => {
  listBlocks.mockResolvedValue({ users: [] });

  await render(<BlockedUsersScreen />);
  expect(await screen.findByText('차단한 사용자가 없어요')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
