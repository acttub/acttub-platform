import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoachingTab from '@/app/(tabs)/coaching';
import { api } from '@/lib/api';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/api', () => ({ api: { listPracticeGroups: jest.fn(), getPracticeNote: jest.fn() } }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));

const listPracticeGroups = api.listPracticeGroups as jest.Mock;
const getPracticeNote = api.getPracticeNote as jest.Mock;

const round = (id: string, at: string, noted: boolean): PracticeRound =>
  ({
    id,
    ordinal: 1,
    created_at: at,
    stage: 'done',
    message_count: 4,
    note: noted ? { id: `note-${id}`, title: '코치가 본 것: 시선이 먼저 내려간다', kind: 'action' } : null,
    conversation_id: null,
    previous_conversations: [],
  }) as unknown as PracticeRound;

function group(overrides: Partial<PracticeGroup>): PracticeGroup {
  return {
    root_id: 'r1',
    title: '카페 장면',
    ordinal_count: 1,
    in_progress_practice_id: null,
    favorite: false,
    hidden_at: null,
    last_practiced_at: '2026-10-01T00:00:00Z',
    poster_url: null,
    practices: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getPracticeNote.mockResolvedValue({ next_take: null, report: null });
});

test('노트가 있는 묶음이 없으면(1턴만 하고 나감) 처음 화면이고, 새 코칭은 첫 안내를 켜고 시작한다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('어떻게 코칭 받을래요?')).toBeOnTheScreen();
  expect(screen.queryByText('지난번 다음에 해볼 것')).not.toBeOnTheScreen();
  expect(getPracticeNote).not.toHaveBeenCalled();
});

test('노트가 있는 가장 최근 묶음의 다음에 해 볼 것을 띄우고, 노트 없이 나간 더 최근 묶음은 건너뛴다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [
      group({ root_id: 'noted', title: '이별 장면', last_practiced_at: '2026-10-01T00:00:00Z', practices: [round('p1', '2026-10-01T00:00:00Z', true)] }),
      group({ root_id: 'left', title: '나간 장면', last_practiced_at: '2026-10-05T00:00:00Z', practices: [round('p2', '2026-10-05T00:00:00Z', false)] }),
    ],
  });
  getPracticeNote.mockResolvedValue({ next_take: '한 박자 바라본 다음 시선을 거둬 보세요.', report: null });
  await render(<CoachingTab />);

  expect(await screen.findByText('한 박자 바라본 다음 시선을 거둬 보세요.')).toBeOnTheScreen();
  expect(getPracticeNote).toHaveBeenCalledWith('p1');
  expect(screen.getByText('지난번 다음에 해볼 것')).toBeOnTheScreen();
  expect(screen.getByText('이별 장면')).toBeOnTheScreen();
  expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();
  expect(screen.queryByText('나간 장면')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '이전 연습 한 번 더' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'noted', practiceId: 'p1' });
  expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
});

test('다음에 해 볼 것을 못 받으면 그 칸 없이 장면 제목만 둔다', async () => {
  listPracticeGroups.mockResolvedValue({ groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', true)] })] });
  getPracticeNote.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);

  expect(await screen.findByText('카페 장면')).toBeOnTheScreen();
  await waitFor(() => expect(getPracticeNote).toHaveBeenCalled());
  expect(screen.queryByText('지난번 다음에 해볼 것')).not.toBeOnTheScreen();
  expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();
});

test('꺾쇠로 홈에 돌아가 다른 길을 고를 수 있다', async () => {
  listPracticeGroups.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);
  await screen.findByText('어떻게 코칭 받을래요?');

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.navigate).toHaveBeenCalledWith('/');
});
