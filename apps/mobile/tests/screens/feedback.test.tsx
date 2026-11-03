import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import FeedbackScreen from '@/app/feedback';
import { logEvent } from '@/lib/analytics';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { kind?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { email: 'me@acttub.app' } }) }));
const mockSend = jest.fn();
jest.mock('@/lib/api', () => ({ api: { sendFeedback: (...args: unknown[]) => mockSend(...args) } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

const TEXT = '채팅이 가끔 느려요, 확인 부탁드려요';

test('메일 칸 없이 의견만 받고, 10자 미만이면 보내기가 꺼져 있다', async () => {
  await render(<FeedbackScreen />);
  expect(screen.queryByText('답장 받을 메일')).toBeNull();
  expect(screen.getByText('0 / 3000')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('의견'), '짧아요');
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
});

test('보내면 feedback 으로 접수하고 같은 화면에 완료 상태와 돌아가기를 보인다', async () => {
  mockSend.mockResolvedValue({ id: 'i1', created_at: 'x' });
  await render(<FeedbackScreen />);
  await fireEvent.changeText(screen.getByLabelText('의견'), TEXT);
  // 메일 칸은 없다 — 계정 메일을 그대로 싣는다.
  expect(screen.queryByDisplayValue('me@acttub.app')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(await screen.findByText('보냈어요. 고마워요!')).toBeOnTheScreen();
  expect(mockSend).toHaveBeenCalledWith({ email: 'me@acttub.app', body: TEXT, category: 'feedback' });
  expect(logEvent).toHaveBeenCalledWith('feedback_sent', undefined);
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

test('계정에 메일이 없거나 형식이 틀리면 답장 없는 자리표시 주소를 싣는다', () => {
  const { feedbackEmail } = jest.requireActual('@/app/feedback') as typeof import('@/app/feedback');
  expect(feedbackEmail('me@acttub.app')).toBe('me@acttub.app');
  expect(feedbackEmail(null)).toBe('no-reply@acttub.com');
  expect(feedbackEmail('not-mail')).toBe('no-reply@acttub.com');
});

test('문의·신고 창구(kind=support)는 분류를 골라야 보낼 수 있고, 고른 분류로 접수한다', async () => {
  mockParams = { kind: 'support' };
  mockSend.mockResolvedValue({ id: 'i2', created_at: 'x' });
  await render(<FeedbackScreen />);
  expect(screen.getByText('문의·신고')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('내용'), TEXT);
  expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: '신고' }));
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(await screen.findByText('보냈어요')).toBeOnTheScreen();
  expect(mockSend).toHaveBeenCalledWith({ email: 'me@acttub.app', body: TEXT, category: 'report' });
  expect(logEvent).toHaveBeenCalledWith('support_sent', { category: 'report' });
});
