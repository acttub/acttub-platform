import { act, fireEvent, render, screen } from '@testing-library/react-native';

import GuestTransferScreen from '@/app/guest-transfer';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';

const mockRouter = { replace: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('@/lib/api', () => ({ api: { transferGuestData: jest.fn() } }));

const send = api.transferGuestData as jest.Mock;
const codeInput = () => screen.getByLabelText('여섯 자리 이관 코드');
const choiceNeeded = () => new ApiError(409, 'choose', 'memory_choice_required');

beforeEach(() => jest.clearAllMocks());

test('숫자만 여섯 자리까지 받고, 다 채워야 가져오기가 켜진다', async () => {
  await render(<GuestTransferScreen />);
  expect(screen.getByRole('button', { name: '가져오기' })).toBeDisabled();

  await fireEvent.changeText(codeInput(), '12a-34');
  expect(codeInput()).toHaveDisplayValue('1234');
  expect(screen.getByRole('button', { name: '가져오기' })).toBeDisabled();

  await fireEvent.changeText(codeInput(), '1234567');
  expect(codeInput()).toHaveDisplayValue('123456');
  expect(screen.getByRole('button', { name: '가져오기' })).toBeEnabled();
});

test('옮기면 완료 화면에서 기록을 보거나 다른 코드를 넣을 수 있다', async () => {
  let finish!: () => void;
  send.mockReturnValue(new Promise<void>((r) => (finish = r)));
  await render(<GuestTransferScreen />);
  await fireEvent.changeText(codeInput(), '123456');
  await fireEvent.press(screen.getByRole('button', { name: '가져오기' }));
  expect(screen.queryByText('가져오기')).not.toBeOnTheScreen();
  await act(async () => finish());

  expect(send).toHaveBeenCalledWith({ code: '123456' });
  expect(await screen.findByText('옮겼어요')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '기록 보기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/history');

  await fireEvent.press(screen.getByRole('button', { name: '다른 코드 입력하기' }));
  expect(codeInput()).toHaveDisplayValue('');
  expect(screen.queryByText('옮겼어요')).not.toBeOnTheScreen();
});

test.each([
  [new ApiError(404, 'nf', 'transfer_code_not_found'), '코드가 맞지 않거나 만료됐어요'],
  [new ApiError(429, 'slow down'), '시도가 너무 많았어요. 잠시 뒤 다시 시도해주세요.'],
  [new ApiError(422, 'bad', 'validation_failed', { field: 'code' }), '코드를 보내지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.'],
  [new Error('서버가 잠시 쉬고 있어요'), '서버가 잠시 쉬고 있어요'],
  ['boom', '가져오지 못했어요. 같은 코드로 다시 시도해주세요.'],
])('실패 %#: 이유를 보여 주고, 코드를 고치면 지운다', async (error, message) => {
  send.mockRejectedValue(error);
  await render(<GuestTransferScreen />);
  await fireEvent.changeText(codeInput(), '123456');
  await fireEvent.press(screen.getByRole('button', { name: '가져오기' }));

  expect(await screen.findByText(message)).toBeOnTheScreen();
  await fireEvent.changeText(codeInput(), '12345');
  expect(screen.queryByText(message)).not.toBeOnTheScreen();
});

describe('양쪽에 액티 기억이 있으면', () => {
  async function openChoice() {
    await render(<GuestTransferScreen />);
    await fireEvent.changeText(codeInput(), '654321');
    await fireEvent.press(screen.getByRole('button', { name: '가져오기' }));
    expect(await screen.findByText('액티의 기억을 어느 쪽으로 둘까요?')).toBeOnTheScreen();
  }

  test('기본은 이 계정의 기억이고, 웹의 기억을 골라 가져올 수 있다', async () => {
    send.mockRejectedValueOnce(choiceNeeded()).mockResolvedValueOnce(undefined);
    await openChoice();

    expect(screen.getByRole('radio', { name: /이 계정의 기억 웹의/ })).toBeSelected();
    await fireEvent.press(screen.getByRole('radio', { name: /웹의 기억 이 계정의/ }));
    expect(screen.getByRole('radio', { name: /웹의 기억 이 계정의/ })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: '이대로 가져오기' }));

    expect(send).toHaveBeenLastCalledWith({ code: '654321', memory_choice: 'guest' });
    expect(await screen.findByText('옮겼어요')).toBeOnTheScreen();
    expect(screen.queryByText('액티의 기억을 어느 쪽으로 둘까요?')).not.toBeOnTheScreen();
  });

  test('닫으면 아무것도 보내지 않고 입력 화면으로 돌아간다', async () => {
    send.mockRejectedValueOnce(choiceNeeded());
    await openChoice();

    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));

    expect(screen.queryByText('액티의 기억을 어느 쪽으로 둘까요?')).not.toBeOnTheScreen();
    expect(send).toHaveBeenCalledTimes(1);
    expect(codeInput()).toHaveDisplayValue('654321');
  });

  test('고른 뒤 실패하면 팝업을 닫고 이유를 보여 준다', async () => {
    send.mockRejectedValueOnce(choiceNeeded()).mockRejectedValueOnce(new ApiError(429, 'slow'));
    await openChoice();

    await fireEvent.press(screen.getByRole('button', { name: '이대로 가져오기' }));

    expect(send).toHaveBeenLastCalledWith({ code: '654321', memory_choice: 'member' });
    expect(await screen.findByText('시도가 너무 많았어요. 잠시 뒤 다시 시도해주세요.')).toBeOnTheScreen();
    expect(screen.queryByText('액티의 기억을 어느 쪽으로 둘까요?')).not.toBeOnTheScreen();
  });

  test('보내는 동안에는 선택지와 닫기를 막는다', async () => {
    let finish!: () => void;
    send.mockRejectedValueOnce(choiceNeeded()).mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    await openChoice();

    await fireEvent.press(screen.getByRole('button', { name: '이대로 가져오기' }));
    expect(screen.getByRole('radio', { name: /웹의 기억 이 계정의/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '닫기' })).toBeDisabled();
    expect(screen.queryByText('이대로 가져오기')).not.toBeOnTheScreen();

    const [, backdrop] = screen.getAllByRole('button');
    await fireEvent.press(backdrop);
    expect(screen.getByText('액티의 기억을 어느 쪽으로 둘까요?')).toBeOnTheScreen();

    await act(async () => finish());
    expect(await screen.findByText('옮겼어요')).toBeOnTheScreen();
  });
});
