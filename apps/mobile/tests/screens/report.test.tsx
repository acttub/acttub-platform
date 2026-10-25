import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ReportScreen from '@/app/report';
import { useAppRating } from '@/hooks/use-app-rating';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { clearPractice, getPractice, setContinueOrigin, type Practice } from '@/lib/practice/session-state';
import { SAMPLE_PRACTICE_ID } from '@/lib/tutorial-sample';
import { practiceNote } from '../helpers/practice-note';

const mockRouter = { push: jest.fn(), dismissAll: jest.fn() };
const mockGetNote = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('expo-video', () => ({
  useVideoPlayer: (_src: unknown, setup?: (p: object) => void) => {
    const player = { addListener: () => ({ remove: () => undefined }) };
    setup?.(player);
    return player;
  },
  VideoView: () => null,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/api', () => ({ api: {} }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/session-state', () => ({
  getPractice: jest.fn(),
  clearPractice: jest.fn(),
  setContinueOrigin: jest.fn(),
}));
jest.mock('@/lib/tutorial-loop', () => ({ loopApiFor: () => ({ getPracticeNote: mockGetNote }) }));
jest.mock('@/hooks/use-app-rating', () => ({ useAppRating: jest.fn() }));
jest.mock('@/hooks/use-spotlight-target', () => ({ useSpotlightTarget: () => ({ ref: undefined, onLayout: undefined }) }));
jest.mock('@/hooks/use-tutorial-spotlight', () => ({
  finishTutorial: jest.fn(),
  useTutorialSpotlight: () => ({ element: null }),
}));

const after = jest.fn();
const scene = { situation: ' 이별 통보 장면 ', character: '수진', goal: '' };

function practice(overrides: Partial<Practice> = {}): Practice {
  return {
    practiceId: 'p1',
    rootId: 'root1',
    ordinal: 2,
    conversationId: 'conv1',
    scene,
    videoUri: '',
    playbackUrl: null,
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAppRating as jest.Mock).mockReturnValue({ after, element: null });
});

test('대화와 함께 온 노트를 바로 보여 주고 서버에서 다시 읽지 않는다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice({ note: practiceNote() }));
  await render(<ReportScreen />);

  expect(screen.getByText('첫 대사의 숨')).toBeOnTheScreen();
  expect(screen.getByText('다음에 해볼 것까지')).toBeOnTheScreen();
  expect(screen.getByText('첫 줄 전에 한 박자 쉬기')).toBeOnTheScreen();
  expect(mockGetNote).not.toHaveBeenCalled();
});

test('「이번에 해 본 것」에는 배우가 한 말만 두고 액티 관찰은 넣지 않는다', async () => {
  const note = practiceNote({
    summary_quotes: [
      { quote: '먼저 미안하다고 해 주길 기다렸어요', kind: 'actor', source_ref: 'actor:1' },
      { quote: '말을 끝낸 직후 시선이 먼저 내려간다', kind: 'observation', source_ref: 'observation:1' },
    ],
  });
  (getPractice as jest.Mock).mockReturnValue(practice({ note }));
  await render(<ReportScreen />);

  expect(screen.getByText('이번에 해 본 것')).toBeOnTheScreen();
  expect(screen.getByText('먼저 미안하다고 해 주길 기다렸어요')).toBeOnTheScreen();
  expect(screen.queryByText('말을 끝낸 직후 시선이 먼저 내려간다')).not.toBeOnTheScreen();
});

test('노트가 없으면 만드는 중을 보이다가 서버에서 읽어 보여 준다', async () => {
  const session = practice();
  (getPractice as jest.Mock).mockReturnValue(session);
  let resolve!: (v: unknown) => void;
  mockGetNote.mockReturnValue(new Promise((r) => (resolve = r)));
  await render(<ReportScreen />);

  expect(screen.getByText('대화를 정리해서 카드를 만들고 있어요…')).toBeOnTheScreen();
  await act(async () => resolve(practiceNote({ title: null, fallback: true })));
  expect(screen.getByText('이별 통보 장면')).toBeOnTheScreen();
  expect(screen.getByText('정리를 다 만들지 못해 확인된 것만 담았어요.')).toBeOnTheScreen();
  expect(mockGetNote).toHaveBeenCalledWith('p1');
  expect(session.note?.id).toBe('n1');
});

test('영상·장면 보기를 펼치면 장면 요약이 보인다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice({ note: practiceNote(), playbackUrl: 'https://v/1.mp4' }));
  await render(<ReportScreen />);

  expect(screen.queryByText('수진')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '영상·장면 보기 펼치기' }));

  expect(screen.getByText('수진')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '영상·장면 보기 접기' })).toBeOnTheScreen();
});

test('다음 테이크 찍기는 이 회차의 장면을 넘기고 업로드로 간다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice({ note: practiceNote() }));
  await render(<ReportScreen />);

  await fireEvent.press(screen.getByText('다음 테이크 찍기'));

  expect(finishTutorial).toHaveBeenCalledWith('done');
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'note', rootId: 'root1', practiceId: 'p1', scene });
  expect(clearPractice).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
});

test('연습 마치기는 앱 평가 차례를 묻고, 그 뒤에 연습을 비우고 나간다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice({ note: practiceNote() }));
  await render(<ReportScreen />);

  await fireEvent.press(screen.getByText('저장하고 마치기'));

  expect(after).toHaveBeenCalledWith({ kind: 'coach', practiceId: 'p1' }, expect.any(Function));
  expect(clearPractice).not.toHaveBeenCalled();
  after.mock.calls[0][1]();
  expect(clearPractice).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
});

test('진행 중인 연습이 없으면 그렇다고 알리고, 홈으로는 평가 없이 나간다', async () => {
  (getPractice as jest.Mock).mockReturnValue(null);
  await render(<ReportScreen />);

  expect(screen.getByText('진행 중인 연습이 없어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('홈으로'));

  expect(after).not.toHaveBeenCalled();
  expect(clearPractice).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
});

test('노트를 못 읽으면 다시 시도로 다시 읽는다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice());
  mockGetNote.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(practiceNote());
  await render(<ReportScreen />);

  expect(await screen.findByText('연습 노트를 불러오지 못했어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));

  expect(await screen.findByText('첫 대사의 숨')).toBeOnTheScreen();
});

test('정리된 노트가 없으면 정리 없음을 보여 준다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice());
  mockGetNote.mockRejectedValue(Object.assign(new Error('nf'), { code: 'note_not_found' }));
  await render(<ReportScreen />);

  expect(await screen.findByText('아직 정리 없음')).toBeOnTheScreen();
});

test('화면을 떠난 뒤 온 노트나 실패는 반영하지 않는다', async () => {
  const session = practice();
  (getPractice as jest.Mock).mockReturnValue(session);
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  mockGetNote.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const first = await render(<ReportScreen />);
  await first.unmount();
  resolve(practiceNote());

  mockGetNote.mockReturnValueOnce(new Promise((_, j) => (reject = j)));
  const second = await render(<ReportScreen />);
  await second.unmount();
  reject(new Error('late'));
  await new Promise((r) => setTimeout(r, 0));

  expect(session.note).toBeNull();
});

describe('튜토리얼 예시 노트', () => {
  beforeEach(() => {
    (getPractice as jest.Mock).mockReturnValue(practice({ practiceId: SAMPLE_PRACTICE_ID, note: practiceNote() }));
  });

  test('평가를 받지 않고 내 영상으로 해 보기를 권한다', async () => {
    await render(<ReportScreen />);

    expect(screen.getByText('둘러보기 끝')).toBeOnTheScreen();
    expect(screen.queryByText('이 코칭 어땠어요?')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('내 영상으로 해 보기'));

    expect(finishTutorial).toHaveBeenCalledWith('done');
    expect(clearPractice).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/upload');
  });

  test('홈으로는 업로드로 가지 않고 닫는다', async () => {
    await render(<ReportScreen />);
    await fireEvent.press(screen.getByText('홈으로'));

    expect(clearPractice).toHaveBeenCalledTimes(1);
    expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

test('제목도 상황도 없으면 장면 메모 없이 연습이라고 부른다', async () => {
  (getPractice as jest.Mock).mockReturnValue(
    practice({ scene: { situation: '  ', character: '', goal: '' }, note: practiceNote({ title: null }) }),
  );
  await render(<ReportScreen />);
  expect(screen.getByText('장면 메모 없이 연습')).toBeOnTheScreen();
});

test('예시 노트를 못 읽었을 때 홈으로는 평가 없이 닫는다', async () => {
  (getPractice as jest.Mock).mockReturnValue(practice({ practiceId: SAMPLE_PRACTICE_ID }));
  mockGetNote.mockRejectedValue(new Error('down'));
  await render(<ReportScreen />);

  await fireEvent.press(await screen.findByText('홈으로'));

  expect(after).not.toHaveBeenCalled();
  expect(finishTutorial).toHaveBeenCalledWith('done');
  expect(clearPractice).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
});
