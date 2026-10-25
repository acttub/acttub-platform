import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import CoachingDoneScreen from '@/app/coaching-done';
import { api } from '@/lib/api';
import { practiceNote } from '../helpers/practice-note';

const mockRouter = { dismissTo: jest.fn(), replace: jest.fn() };
let mockParams: { practiceId?: string; saved?: string } = {};
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
jest.mock('@/lib/practice/first-use-graduation', () => ({ markFirstUseGraduated: jest.fn(async () => undefined), currentFirstUseOwner: () => null }));

const getPracticeNote = api.getPracticeNote as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { practiceId: 'p1', saved: '1' };
});

test('오늘 코칭 끝 — 일지 저장 알림, 코칭 평가(노트에 남김), 「확인」은 홈(pen P16.1)', async () => {
  const { markFirstUseGraduated } = jest.requireMock('@/lib/practice/first-use-graduation');
  getPracticeNote.mockResolvedValue(practiceNote());
  await render(<CoachingDoneScreen />);

  expect(screen.getByText('오늘 코칭 끝!')).toBeOnTheScreen();
  // 코칭을 마무리까지 왔으니 첫 사용자 화면은 졸업이다(SOMA-827).
  expect(markFirstUseGraduated).toHaveBeenCalled();
  expect(await screen.findByText('첫 줄 전에 한 박자 쉬기')).toBeOnTheScreen();
  expect(screen.getByText('다음에 해 볼 것')).toBeOnTheScreen();
  expect(await screen.findByText('이 코칭 어땠어요?')).toBeOnTheScreen();
  expect(screen.getByText('도움 됐어요')).toBeOnTheScreen();
  expect(screen.getByText('아쉬웠어요')).toBeOnTheScreen();
  expect(getPracticeNote).toHaveBeenCalledWith('p1');

  await fireEvent.press(screen.getByRole('button', { name: '확인' }));
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
