import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import FeedbackScreen from '@/app/feedback';
import { logEvent } from '@/lib/analytics';

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => true }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { email: 'me@acttub.app' } }) }));
const mockSend = jest.fn();
jest.mock('@/lib/api', () => ({ api: { sendFeedback: (...args: unknown[]) => mockSend(...args) } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));

beforeEach(() => jest.clearAllMocks());

const TEXT = '채팅이 가끔 느려요, 확인 부탁드려요';

test('계정 메일이 미리 채워지고, 10자 미만이면 보내기가 꺼져 있다', async () => {
  await render(<FeedbackScreen />);
  expect(screen.getByDisplayValue('me@acttub.app')).toBeOnTheScreen();
  expect(screen.getByText('0 / 3000')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('의견'), '짧아요');
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
});

test('보내면 feedback 으로 접수하고 같은 화면에 완료 상태와 돌아가기를 보인다', async () => {
  mockSend.mockResolvedValue({ id: 'i1', created_at: 'x' });
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('의견'), TEXT);
  await fireEvent.changeText(screen.getByDisplayValue('me@acttub.app'), 'other@acttub.app');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(await screen.findByText('보냈어요. 고마워요!')).toBeOnTheScreen();
  expect(mockSend).toHaveBeenCalledWith({ email: 'other@acttub.app', body: TEXT });
  expect(logEvent).toHaveBeenCalledWith('feedback_sent');
  await fireEvent.press(screen.getByRole('button', { name: '돌아가기' }));
  expect(mockBack).toHaveBeenCalled();
});

test('429 는 잠시 뒤 다시 안내하고, 입력은 그대로 남는다', async () => {
  mockSend.mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }));
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('의견'), TEXT);
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(await screen.findByText('한꺼번에 많이 보냈어요. 잠시 뒤 다시 보내 주세요.')).toBeOnTheScreen();
  expect(screen.getByDisplayValue(TEXT)).toBeOnTheScreen();
  expect(logEvent).not.toHaveBeenCalled();
});

test('잘못된 메일 주소면 보내기가 꺼지고 안내가 뜬다', async () => {
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('의견'), TEXT);
  await fireEvent.changeText(screen.getByDisplayValue('me@acttub.app'), 'nope');
  await waitFor(() => expect(screen.getByText('메일 주소를 확인해 주세요')).toBeOnTheScreen());
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
});
