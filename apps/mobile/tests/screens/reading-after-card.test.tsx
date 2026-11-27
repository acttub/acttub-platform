import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ReadingAfterCard } from '@/components/reading-after-card';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

const mockRouter = { push: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    getReadingVoiceCoaching: jest.fn(),
    billingMe: jest.fn(),
    createPractice: jest.fn(),
  },
}));

const voice = api.getReadingVoiceCoaching as jest.Mock;
const billing = api.billingMe as jest.Mock;
const create = api.createPractice as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test('available 이면 코칭 카드(위)와 발음 보고서 줄(아래)을 보이고, 코칭 받기는 회차를 만들어 코치 화면으로 간다 — Pro 는 발음 보고서로 간다(SOMA-791·606)', async () => {
  voice.mockResolvedValue({ available: true, practice_id: null });
  billing.mockResolvedValue({ pro: true });
  create.mockResolvedValue({ id: 'p1', root_id: 'p1', ordinal: 1 });
  await render(<ReadingAfterCard sessionId="s1" ready />);

  expect(await screen.findByText('방금 읽은 대본으로 코칭도 받아볼까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '코칭 받기' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { purpose: 'reading' } }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ reading_session_id: 's1', request_id: expect.any(String) }));
  await fireEvent.press(await screen.findByText('발음 보고서 받기'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/reading/pronunciation', params: { sessionId: 's1' } });
});

test('이미 시작한 회차가 있으면 새로 만들지 않고 그 회차를 연다', async () => {
  voice.mockResolvedValue({ available: true, practice_id: 'p9' });
  billing.mockRejectedValue(new Error('x'));
  await render(<ReadingAfterCard sessionId="s1" ready />);
  await fireEvent.press(await screen.findByRole('button', { name: '코칭 받기' }));
  expect(create).not.toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'p9' } });
});

test('available 거짓·오류(404 포함)면 코칭 카드를 그리지 않고, 녹음이 올라가는 중이면 묻지 않는다', async () => {
  voice.mockResolvedValue({ available: false, practice_id: null });
  billing.mockResolvedValue({ pro: false });
  const view = await render(<ReadingAfterCard sessionId="s1" ready />);
  await waitFor(() => expect(voice).toHaveBeenCalled());
  expect(screen.queryByText('코칭 받기')).not.toBeOnTheScreen();
  await view.unmount();

  voice.mockRejectedValue(Object.assign(new Error('x'), { code: 'Not Found' }));
  const view2 = await render(<ReadingAfterCard sessionId="s1" ready />);
  await waitFor(() => expect(voice).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('코칭 받기')).not.toBeOnTheScreen();
  await view2.unmount();

  jest.clearAllMocks();
  await render(<ReadingAfterCard sessionId="s1" ready={false} />);
  expect(voice).not.toHaveBeenCalled();
  expect(billing).not.toHaveBeenCalled();
});

test('발음 보고서 줄은 무료에게도 보이고, 누르면 잠김을 기록하고 바로 Pro 안내(from=pron)를 연다(11/27)', async () => {
  voice.mockResolvedValue({ available: false, practice_id: null });
  billing.mockResolvedValue({ pro: false });
  await render(<ReadingAfterCard sessionId="s1" ready part="report" />);
  await waitFor(() => expect(billing).toHaveBeenCalled());

  await fireEvent.press(await screen.findByText('발음 보고서 받기'));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/pro', params: { from: 'pron' } });
  expect(logEvent).toHaveBeenCalledWith('reading_pron_report_locked', {});
});

test('구독 상태를 못 받으면 무료로 보고 Pro 안내를 연다', async () => {
  billing.mockRejectedValue(Object.assign(new Error('x'), { code: 'Not Found' }));
  await render(<ReadingAfterCard sessionId="s1" ready part="report" />);
  await fireEvent.press(await screen.findByText('발음 보고서 받기'));
  await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/pro', params: { from: 'pron' } }));
});

test('구독 상태를 확인하는 동안 두 번 눌러도 Pro 안내는 한 번만 열린다', async () => {
  let settle: (v: { pro: boolean }) => void = () => undefined;
  // 처음 받기는 끝나지 않게 둬서 pro 가 null 인 채로 누르게 한다.
  billing.mockReturnValueOnce(new Promise(() => undefined)).mockReturnValueOnce(new Promise((r) => (settle = r)));
  await render(<ReadingAfterCard sessionId="s1" ready part="report" />);
  const row = await screen.findByText('발음 보고서 받기');
  await fireEvent.press(row);
  await fireEvent.press(row);
  settle({ pro: false });
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(billing).toHaveBeenCalledTimes(2);
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/pro', params: { from: 'pron' } });
});

test('시작이 실패하면 카드 안에 이유를 알린다', async () => {
  voice.mockResolvedValue({ available: true, practice_id: null });
  create.mockRejectedValue(Object.assign(new Error('x'), { code: 'reading_voice_not_enough_audio' }));
  await render(<ReadingAfterCard sessionId="s1" ready part="coach" />);
  await fireEvent.press(await screen.findByRole('button', { name: '코칭 받기' }));
  expect(await screen.findByText('소리가 든 내 대사 녹음이 3개 이상 있어야 해요.')).toBeOnTheScreen();
});
