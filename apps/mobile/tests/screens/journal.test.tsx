import { act, fireEvent, render, screen } from '@testing-library/react-native';

import JournalScreen from '@/app/journal';
import { useAppRating } from '@/hooks/use-app-rating';
import { api } from '@/lib/api';
import type { PracticeJournal } from '@/lib/practice/journal';
import { clearPractice, getPractice } from '@/lib/practice/session-state';

const mockRouter = { push: jest.fn(), dismissAll: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: { practiceId?: string; from?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/api', () => ({
  api: { getPracticeJournal: jest.fn(), createPracticeJournal: jest.fn(), updatePracticeJournal: jest.fn() },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/session-state', () => ({ getPractice: jest.fn(), clearPractice: jest.fn() }));
jest.mock('@/hooks/use-app-rating', () => ({ useAppRating: jest.fn() }));

const getJournal = api.getPracticeJournal as jest.Mock;
const createJournal = api.createPracticeJournal as jest.Mock;
const updateJournal = api.updatePracticeJournal as jest.Mock;
const after = jest.fn((_target: unknown, leave: () => void) => leave());

function journal(overrides: Partial<PracticeJournal> = {}): PracticeJournal {
  return {
    id: 'j1',
    practice_id: 'p1',
    conversation_id: 'c1',
    answers: {
      feeling: { choice: '떨렸어요', text: '낮게 하니까 오히려 더 떨렸어요' },
      unknown: { none: false, text: '「잘 지내」가 서운한 건지 담담한 건지 모르겠어요' },
      next: { undecided: false, text: '「잘 지내」부터 준호를 보며 말하기' },
      review: '준호를 보니까 「잘 지내」가 진짜 작별처럼 느껴졌다',
    },
    draft_status: 'ready',
    practice: [{ text: '준호를 보며 선 긋기로 다시 해 봤어요', basis: 'actor_report' }],
    character: [{ aspect: 'wants', text: '서연은 준호가 붙잡지 않고 보내 주길 바라요' }],
    feedback: [{ text: '「잘 지내」부터 준호를 안 보고 말해 혼잣말처럼 들렸어요', giver: 'coach', at: 31 }],
    edited_at: null,
    created_at: '2026-10-23T03:00:00Z',
    updated_at: '2026-10-23T03:00:00Z',
    title: '「잘 지내」 장면',
    purpose: 'evaluate',
    role_name: '서연',
    ...overrides,
  };
}

const missing = () => Promise.reject(Object.assign(new Error('nf'), { code: 'journal_not_found' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  (getPractice as jest.Mock).mockReturnValue({ practiceId: 'p1' });
  (useAppRating as jest.Mock).mockReturnValue({ after, element: null });
});

test('일지가 없으면 고정 질문 4개를 묻고, 건너뛰기·직접 쓰기 뒤 「일지 만들기」로 만든다', async () => {
  getJournal.mockImplementation(missing);
  createJournal.mockResolvedValue(journal());
  await render(<JournalScreen />);

  expect(await screen.findByText('해 보니 어땠어요?')).toBeOnTheScreen();
  expect(screen.getByText('1 / 4')).toBeOnTheScreen();
  expect(screen.getByText('고르거나 적고 「다음」 버튼을 누르세요. 없으면 「건너뛰기」를 누르세요.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  // 아래 고정 바는 보조 글자 버튼이 위, 주 버튼이 맨 아래다.
  const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
  expect(names.slice(-2)).toEqual(['건너뛰기', '다음']);
  await fireEvent.press(screen.getByText('떨렸어요'));
  await fireEvent.changeText(screen.getByLabelText('해 보니 어땠어요?'), '  낮게 하니까 오히려 더 떨렸어요 ');
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  expect(screen.getByText('아직 헷갈리거나 궁금한 게 있어요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('건너뛰기'));
  expect(screen.getByText('다음엔 뭘 해 볼래요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('아직 안 정했어요'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));

  expect(screen.getByText('오늘 연습을 한 줄로 남긴다면?')).toBeOnTheScreen();
  expect(screen.getByText('고르거나 적고 「일지 만들기」 버튼을 누르세요. 없으면 「건너뛰기」를 누르세요.')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('오늘 연습을 한 줄로 남긴다면?'), '준호를 보니까 진짜 작별 같았다');
  await fireEvent.press(screen.getByRole('button', { name: '일지 만들기' }));

  expect(createJournal).toHaveBeenCalledWith('p1', {
    feeling: { choice: 'nervous', text: '낮게 하니까 오히려 더 떨렸어요' },
    unknown: null,
    next: { undecided: true, text: null },
    review: '준호를 보니까 진짜 작별 같았다',
  });
  expect(await screen.findByText('“준호를 보니까 「잘 지내」가 진짜 작별처럼 느껴졌다”')).toBeOnTheScreen();
});

test('요약형 완성 일지 — 위 상자·다음에 해 볼 것·한 줄 미리보기, 누르면 펼친다', async () => {
  getJournal.mockResolvedValue(journal());
  await render(<JournalScreen />);

  expect(await screen.findByText('10월 23일 · 서연 역 · 평가 받기')).toBeOnTheScreen();
  expect(screen.getByText('「잘 지내」 장면')).toBeOnTheScreen();
  expect(screen.getByText('떨렸어요')).toBeOnTheScreen();
  expect(screen.getByText('아직 모르는 것 1개')).toBeOnTheScreen();
  expect(screen.getByText('「잘 지내」부터 준호를 보며 말하기')).toBeOnTheScreen();
  for (const label of ['액티가 본 장면', '오늘 한 연습', '해 보니', '장면과 인물', '아직 모르는 것']) {
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
  expect(screen.queryByText('▶ 0:31 · 「잘 지내」부터 준호를 안 보고 말해 혼잣말처럼 들렸어요')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('액티가 본 장면'));
  expect(screen.getByText('▶ 0:31 · 「잘 지내」부터 준호를 안 보고 말해 혼잣말처럼 들렸어요')).toBeOnTheScreen();
});

test('빈 칸은 숨기고, 자동 칸을 못 만들었으면 배우 답만 보이며 그렇게 알린다', async () => {
  getJournal.mockResolvedValue(journal({
    draft_status: 'failed', practice: [], character: [], feedback: [],
    answers: { feeling: null, unknown: { none: true, text: null }, next: null, review: '짧게 남김' },
  }));
  await render(<JournalScreen />);

  expect(await screen.findByText('“짧게 남김”')).toBeOnTheScreen();
  expect(screen.getByText('대화 정리는 만들지 못해 내가 쓴 답만 담았어요.')).toBeOnTheScreen();
  for (const label of ['액티가 본 장면', '오늘 한 연습', '해 보니', '장면과 인물', '아직 모르는 것', '다음에 해 볼 것']) {
    expect(screen.queryByText(label)).not.toBeOnTheScreen();
  }
});

test('「편집」으로 후기·다음에 해 볼 것·줄을 고쳐 「저장하기」 하면 저장 뒤 오늘 코칭 끝으로 간다', async () => {
  getJournal.mockResolvedValue(journal());
  updateJournal.mockImplementation(async (_id, body) => journal({ answers: body.answers }));
  await render(<JournalScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '편집' }));
  expect(screen.getByText('눌러서 고칠 수 있어요')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('오늘 연습을 한 줄로 남긴다면?'), '고친 후기');
  await fireEvent.changeText(screen.getByLabelText('다음에 해 볼 것'), '준호 눈 보고 말하기');
  await fireEvent.changeText(screen.getAllByLabelText('오늘 한 연습')[0], '고친 연습');
  await fireEvent.press(screen.getByRole('button', { name: '저장하기' }));

  const body = updateJournal.mock.calls[0][1];
  expect(body.answers.review).toBe('고친 후기');
  expect(body.answers.next).toEqual({ undecided: false, text: '준호 눈 보고 말하기' });
  expect(body.practice).toEqual([{ text: '고친 연습', basis: 'actor_report' }]);
  expect(after).toHaveBeenCalledWith({ kind: 'coach', practiceId: 'p1' }, expect.any(Function));
  expect(clearPractice).toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/coaching-done',
    params: { practiceId: 'p1', saved: '1' },
  });
});

test('연습 기록에서 다시 열면 같은 화면 — 「저장하기」는 고칠 때만 있고 「완료」로 저장하고 머문다', async () => {
  mockParams = { practiceId: 'p9', from: 'history' };
  getJournal.mockResolvedValue(journal({ practice_id: 'p9' }));
  updateJournal.mockResolvedValue(journal({ practice_id: 'p9' }));
  await render(<JournalScreen />);

  expect(await screen.findByText('「잘 지내」 장면')).toBeOnTheScreen();
  expect(getJournal).toHaveBeenCalledWith('p9');
  expect(screen.queryByRole('button', { name: '저장하기' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  await act(async () => undefined);

  expect(updateJournal).toHaveBeenCalledWith('p9', expect.objectContaining({ answers: expect.any(Object) }));
  expect(screen.getByRole('button', { name: '편집' })).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('인물 이해하기는 장면과 인물이 목록 맨 위다', async () => {
  getJournal.mockResolvedValue(journal({ purpose: 'character' }));
  await render(<JournalScreen />);

  expect(await screen.findByText('10월 23일 · 서연 역 · 인물 이해하기')).toBeOnTheScreen();
  const labels = screen.getAllByText(/^(액티가 본 장면|오늘 한 연습|해 보니|장면과 인물|아직 모르는 것)$/).map((node) => node.props.children);
  expect(labels[0]).toBe('장면과 인물');
});

test('일지를 못 만들면 질문에 남아 다시 시도할 수 있다', async () => {
  getJournal.mockImplementation(missing);
  createJournal.mockRejectedValue(new Error('down'));
  await render(<JournalScreen />);

  await fireEvent.press(await screen.findByText('건너뛰기'));
  await fireEvent.press(screen.getByText('건너뛰기'));
  await fireEvent.press(screen.getByText('건너뛰기'));
  await fireEvent.press(screen.getByText('건너뛰기'));

  expect(await screen.findByText('일지를 만들지 못했어요. 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(createJournal).toHaveBeenCalledWith('p1', { feeling: null, unknown: null, next: null, review: null });
  expect(screen.getByText('오늘 연습을 한 줄로 남긴다면?')).toBeOnTheScreen();
});
