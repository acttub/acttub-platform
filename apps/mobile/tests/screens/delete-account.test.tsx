import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import DeleteAccountScreen from '@/app/delete-account';
import { useAuth } from '@/lib/auth';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack }) }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));

const deleteAccount = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ user: { email: 'me@acttub.app' }, deleteAccount });
});

test('확인 줄을 눌러야 탈퇴 버튼이 켜지고, 두 번 확인하면 계정을 지운다', async () => {
  deleteAccount.mockResolvedValue(undefined);
  await render(<DeleteAccountScreen />);

  expect(screen.getByText('me@acttub.app')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '탈퇴하기' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: /연습·노트는 돌아오지 않아요/ }));
  expect(screen.getByRole('checkbox')).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));

  expect(await screen.findByText('정말 탈퇴할까요?')).toBeOnTheScreen();
  const labels = screen.getAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('정말 탈퇴할까요?')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '그대로 쓸게요' })).toBeDisabled();
});

test('확인 창에서 취소하면 지우지 않는다', async () => {
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  await fireEvent.press(await screen.findByText('취소'));

  expect(screen.queryByText('정말 탈퇴할까요?')).not.toBeOnTheScreen();
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '탈퇴하기' })).toBeEnabled();
});

test('탈퇴가 실패하면 서버 문구와 함께 계정이 남았다고 알린다', async () => {
  deleteAccount.mockRejectedValue(new Error('서버 점검 중'));
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  const labels = await screen.findAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  expect(await screen.findByText('탈퇴하지 못했어요')).toBeOnTheScreen();
  expect(screen.getByText('서버 점검 중\n계정은 그대로 있어요.')).toBeOnTheScreen();
});

test('오류 객체가 아니면 일반 실패 문구를 보여 준다', async () => {
  (useAuth as jest.Mock).mockReturnValue({ user: null, deleteAccount });
  deleteAccount.mockRejectedValue('boom');
  await render(<DeleteAccountScreen />);
  expect(screen.queryByText('me@acttub.app')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  const labels = await screen.findAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  expect(await screen.findByText('잠시 후 다시 시도해주세요. 계정은 그대로 있어요.')).toBeOnTheScreen();
});

test('그대로 쓰기를 누르면 이전 화면으로 돌아간다', async () => {
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '그대로 쓸게요' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
