import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ReadingAfterCard } from '@/components/reading-after-card';
import { api } from '@/lib/api';

const mockRouter = { push: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    getReadingVoiceCoaching: jest.fn(),
    getPronunciationReport: jest.fn(),
    createPractice: jest.fn(),
  },
}));

const voice = api.getReadingVoiceCoaching as jest.Mock;
const report = api.getPronunciationReport as jest.Mock;
const create = api.createPractice as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test('available 이면 코칭 카드(위)와 발음 보고서 줄(아래)을 보이고, 코칭 받기는 회차를 만들어 코치 화면으로 간다(SOMA-791·606)', async () => {
  voice.mockResolvedValue({ available: true, practice_id: null });
  report.mockResolvedValue({ status: 'queued', report: null });
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
  report.mockRejectedValue(new Error('x'));
  await render(<ReadingAfterCard sessionId="s1" ready />);
  await fireEvent.press(await screen.findByRole('button', { name: '코칭 받기' }));
  expect(create).not.toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'p9' } });
});

test('available 거짓·오류(404 포함)면 카드를 그리지 않고, 녹음이 올라가는 중이면 묻지 않는다', async () => {
  voice.mockResolvedValue({ available: false, practice_id: null });
  report.mockRejectedValue(Object.assign(new Error('x'), { code: 'pronunciation_not_available' }));
  const view = await render(<ReadingAfterCard sessionId="s1" ready />);
  await waitFor(() => expect(report).toHaveBeenCalled());
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
  expect(report).not.toHaveBeenCalled();
});

test('시작이 실패하면 카드 안에 이유를 알린다', async () => {
  voice.mockResolvedValue({ available: true, practice_id: null });
  report.mockRejectedValue(new Error('x'));
  create.mockRejectedValue(Object.assign(new Error('x'), { code: 'reading_voice_not_enough_audio' }));
  await render(<ReadingAfterCard sessionId="s1" ready part="coach" />);
  await fireEvent.press(await screen.findByRole('button', { name: '코칭 받기' }));
  expect(await screen.findByText('소리가 든 내 대사 녹음이 3줄 이상 있어야 해요.')).toBeOnTheScreen();
});
