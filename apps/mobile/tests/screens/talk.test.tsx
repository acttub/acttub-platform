import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TalkScreen from '@/app/talk';
import { api } from '@/lib/api';
import { startPractice } from '@/lib/practice/session-state';

const mockRouter = { replace: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/api', () => ({ api: { createPractice: jest.fn(), listPracticeGroups: jest.fn() } }));
jest.mock('@/lib/practice/session-state', () => ({ startPractice: jest.fn() }));

const createPractice = api.createPractice as jest.Mock;
const listPracticeGroups = api.listPracticeGroups as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test('목적 · 영상 없이 — 세 목적을 보이고, 하나를 고르고 「다음」을 눌러야 영상 없이 시작해 액티 대화로 간다 (SOMA-745)', async () => {
  createPractice.mockResolvedValue({ id: 'p1', root_id: 'p1', ordinal: 1, stage: 'conversing', analysis_status: null, job: null });
  await render(<TalkScreen />);

  expect(screen.getByText('말로 어떤 도움을 받을까요?')).toBeOnTheScreen();
  expect(screen.getByText('인물 이해하기')).toBeOnTheScreen();
  expect(screen.getByText('오디션·입시·연습 고민이 있으면')).toBeOnTheScreen();
  // 기본 선택 없음 — 고르기만 해서는 시작하지 않는다.
  await fireEvent.press(screen.getByRole('radio', { name: '고민 상담' }));
  expect(createPractice).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/coach'));
  const body = createPractice.mock.calls[0][0];
  expect(body.session_purpose).toBe('concern');
  expect(body).not.toHaveProperty('video_id');
  expect(startPractice).toHaveBeenCalledWith(expect.objectContaining({ practiceId: 'p1', videoUri: '', playbackUrl: null }));
});

test('같은 목적을 다시 누르면 같은 요청 id 로 보낸다 — 실패하면 다시 누르라고 알린다', async () => {
  createPractice.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 400, code: 'bad' }));
  createPractice.mockResolvedValueOnce({ id: 'p2', root_id: 'p2', ordinal: 1, stage: 'conversing', analysis_status: null, job: null });
  await render(<TalkScreen />);

  await fireEvent.press(screen.getByRole('radio', { name: '막힌 곳 풀기' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(await screen.findByText('코칭을 시작하지 못했어요. 다시 눌러 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/coach'));
  expect(createPractice.mock.calls[0][0].request_id).toBe(createPractice.mock.calls[1][0].request_id);
});

test('진행 중인 회차가 있으면(409) 그 대화로 간다', async () => {
  createPractice.mockRejectedValue(Object.assign(new Error('in progress'), { status: 409, code: 'practice_in_progress' }));
  listPracticeGroups.mockResolvedValue({ groups: [{ root_id: 'r1', in_progress_practice_id: 'open-1' }] });
  await render(<TalkScreen />);

  await fireEvent.press(screen.getByRole('radio', { name: '인물 이해하기' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } }));
});

test('진행 중인 회차가 있는데(409) 그 회차를 찾지 못하면 찾지 못했다고 알린다', async () => {
  createPractice.mockRejectedValue(Object.assign(new Error('in progress'), { status: 409, code: 'practice_in_progress' }));
  listPracticeGroups.mockResolvedValue({ groups: [] });
  await render(<TalkScreen />);

  await fireEvent.press(screen.getByRole('radio', { name: '고민 상담' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  expect(await screen.findByText('진행 중인 코칭을 찾지 못했어요. 다시 눌러 주세요.')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
