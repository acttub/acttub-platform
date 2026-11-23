import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

import CoachingDoneScreen from '@/app/coaching-done';
import { api } from '@/lib/api';
import { practiceNote } from '../helpers/practice-note';

const mockRouter = { dismissTo: jest.fn(), replace: jest.fn() };
let mockParams: { practiceId?: string; saved?: string; startedAt?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/api', () => ({ api: { getPracticeNote: jest.fn(), putNoteRating: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/first-use-graduation', () => ({ markFirstUseGraduated: jest.fn(async () => undefined), currentFirstUseOwner: () => 'u1' }));
jest.mock('@/lib/practice-days', () => ({ rememberSessionPracticeDay: jest.fn() }));

const getPracticeNote = api.getPracticeNote as jest.Mock;
const { rememberSessionPracticeDay } = jest.requireMock('@/lib/practice-days');

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { practiceId: 'p1', saved: '1' };
});

test('오늘 코칭 끝 — DoneScreen 틀, 코칭 평가(노트에 남김), 「홈으로 가기」는 홈', async () => {
  const { markFirstUseGraduated } = jest.requireMock('@/lib/practice/first-use-graduation');
  getPracticeNote.mockResolvedValue(practiceNote());
  await render(<CoachingDoneScreen />);

  // 코칭을 마무리까지 왔으니 첫 사용자 화면은 졸업이다(SOMA-827).
  expect(markFirstUseGraduated).toHaveBeenCalled();
  expect(await screen.findByText('첫 줄 전에 한 박자 쉬기')).toBeOnTheScreen();
  expect(screen.getByText('다음에 해 볼 것')).toBeOnTheScreen();
  expect(await screen.findByText('이 코칭 어땠어요?')).toBeOnTheScreen();
  expect(screen.getByText('도움 됐어요')).toBeOnTheScreen();
  expect(screen.getByText('아쉬웠어요')).toBeOnTheScreen();
  expect(getPracticeNote).toHaveBeenCalledWith('p1');

  await fireEvent.press(screen.getByRole('button', { name: '홈으로 가기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)');
});

test('노트가 없으면 평가 칸을 두지 않고, 공유는 시스템 공유 창을 연다', async () => {
  getPracticeNote.mockRejectedValue(Object.assign(new Error('nf'), { code: 'note_not_found' }));
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await render(<CoachingDoneScreen />);

  expect(screen.queryByText('이 코칭 어땠어요?')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('SNS에 공유하기'));
  expect(share).toHaveBeenCalledWith({ message: '오늘 Acttub에서 연기 연습을 했어요.' });
});

// SOMA-1075 — 노트가 있으면 서버도 연습 1회로 센다. 시작한 날을 메모리에 적어 홈이 서버를 기다리지 않고 불꽃을 띄운다.
describe('연습한 날 미리 적기', () => {
  test('자정 전에 시작해 자정을 넘겨 끝낸 코칭은 끝낸 날이 아니라 시작 시각으로 적는다', async () => {
    mockParams = { practiceId: 'p1', startedAt: '2026-10-31T14:50:00.000Z' };
    getPracticeNote.mockResolvedValue(practiceNote());
    await render(<CoachingDoneScreen />);
    await screen.findByText('이 코칭 어땠어요?');
    expect(rememberSessionPracticeDay).toHaveBeenCalledWith('2026-10-31T14:50:00.000Z', 'u1');
  });

  test('며칠 전에 시작한 코칭을 이어 마치면 그 시작 시각으로 적는다', async () => {
    mockParams = { practiceId: 'p1', startedAt: '2026-10-25T03:00:00.000Z' };
    getPracticeNote.mockResolvedValue(practiceNote());
    await render(<CoachingDoneScreen />);
    await screen.findByText('이 코칭 어땠어요?');
    expect(rememberSessionPracticeDay).toHaveBeenCalledWith('2026-10-25T03:00:00.000Z', 'u1');
  });

  test('노트가 없는 회차(그만·영상 아님·생성 실패)는 적지 않는다', async () => {
    mockParams = { practiceId: 'p1', startedAt: '2026-10-31T14:50:00.000Z' };
    getPracticeNote.mockRejectedValue(Object.assign(new Error('nf'), { code: 'note_not_found' }));
    await render(<CoachingDoneScreen />);
    await waitFor(() => expect(getPracticeNote).toHaveBeenCalled());
    await act(async () => undefined);
    expect(rememberSessionPracticeDay).not.toHaveBeenCalled();
  });

  test('노트를 읽기 전에 화면을 떠나면 적지 않는다', async () => {
    mockParams = { practiceId: 'p1', startedAt: '2026-10-31T14:50:00.000Z' };
    let resolve: (v: unknown) => void = () => undefined;
    getPracticeNote.mockReturnValue(new Promise((r) => (resolve = r)));
    const view = await render(<CoachingDoneScreen />);
    await view.unmount();
    await act(async () => resolve(practiceNote()));
    expect(rememberSessionPracticeDay).not.toHaveBeenCalled();
  });
});
