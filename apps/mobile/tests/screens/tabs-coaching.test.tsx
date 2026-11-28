import { fireEvent, render, screen } from '@testing-library/react-native';

import CoachingSection from '@/components/practice/coaching-pane';
import { api } from '@/lib/api';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { rememberSkeletonHints, resetSkeletonHints } from '@/lib/skeleton-hint';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/api', () => ({ api: { getPracticeNote: jest.fn(), getPracticeJournal: jest.fn() } }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
// 영상 올리는 중 카드(예전 홈 맨 위, SOMA-1120) — 카드 자체는 tests/components/home-upload-card 가 본다.
const mockWaiting = { card: null as null | { state: 'uploading'; waiting: { scene: { situation: string } } }, error: null, busy: false, retry: jest.fn(), begin: jest.fn() };
jest.mock('@/hooks/use-waiting-upload', () => ({ useWaitingUpload: () => mockWaiting }));

const getPracticeNote = api.getPracticeNote as jest.Mock;

const round = (id: string, at: string, noted: boolean): PracticeRound =>
  ({
    id,
    ordinal: 1,
    created_at: at,
    stage: 'done',
    message_count: 4,
    note: noted ? { id: `note-${id}`, title: '액티가 본 것: 시선이 먼저 내려간다', kind: 'action' } : null,
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

const show = (groups: PracticeGroup[] | null, failed = false, onRetry = jest.fn()) =>
  render(<CoachingSection groups={groups} failed={failed} onRetry={onRetry} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockWaiting.card = null;
  resetSkeletonHints();
  getPracticeNote.mockResolvedValue({ next_take: null, report: null });
  (api.getPracticeJournal as jest.Mock).mockRejectedValue(new Error('none'));
});

test('영상을 올리는 중이면 구역 맨 위에 그 카드를 둔다 — 코칭 이어 하기(SOMA-1120, 예전 홈)', async () => {
  mockWaiting.card = { state: 'uploading', waiting: { scene: { situation: '카페 이별 장면' } } };
  await show([]);
  expect(screen.getByTestId('home-upload-card')).toBeOnTheScreen();
  expect(screen.getByText('카페 이별 장면')).toBeOnTheScreen();
});

test('노트가 있는 묶음이 없으면(처음) 메모·최근 코칭 없이 비워 둔다 — 코칭 시작은 단계 칸 ③이 맡는다', async () => {
  await show([group({ practices: [round('p1', '2026-10-01T00:00:00Z', false)] })]);
  expect(screen.queryByText('저번 코치 메모')).not.toBeOnTheScreen();
  expect(screen.queryByText('최근 코칭')).not.toBeOnTheScreen();
  expect(screen.queryByText('코칭이 처음이죠?')).not.toBeOnTheScreen();
});

test('노트가 있는 묶음이 있으면 저번 코치 메모 → 다른 방법 → 최근 코칭 순서이고 각 입구가 제자리로 간다', async () => {
  getPracticeNote.mockResolvedValue({ next_take: '다음엔 시선을 끝까지 들고 있어 봐요.', report: null });
  await show([group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })]);

  expect(await screen.findByText('다음엔 시선을 끝까지 들고 있어 봐요.')).toBeOnTheScreen();
  // 「새 영상으로 코칭 받기」 타일은 맨 위 단계 칸 ③과 겹쳐 뺐다.
  expect(screen.queryByRole('button', { name: '새 영상으로 코칭 받기' })).not.toBeOnTheScreen();
  const hosts = screen.container.queryAll((node) => typeof node.type === 'string');
  const at = (el: unknown) => hosts.indexOf(el as (typeof hosts)[number]);
  const order = [at(screen.getByText('저번 코치 메모')), at(screen.getByRole('button', { name: '다른 방법으로 코칭 받기' })), at(screen.getByText('최근 코칭'))];
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  await fireEvent.press(screen.getByRole('button', { name: '다른 방법으로 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/coach-other');
  await fireEvent.press(screen.getByRole('button', { name: '지난 코칭 다시 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
  // 메모 카드 「한 번 더 연습」 — 열린 대화가 없으면 다음 테이크(새 영상)로.
  await fireEvent.press(screen.getByRole('button', { name: '한 번 더 연습' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'r1', practiceId: 'p1' });
  expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
});

test('대화 중인 묶음이 있으면 「하던 코칭 · 이어서 하기」가 그 회차의 액티 화면으로 바로 간다', async () => {
  await show([group({ root_id: 'open', title: '카페, 헤어지자는 말', in_progress_practice_id: 'open-1', practices: [round('open-1', '2026-10-01T00:00:00Z', false)] })]);

  expect(screen.getByText('코치와 하던 대화가 남아 있어요.')).toBeOnTheScreen();
  expect(screen.getAllByText('카페, 헤어지자는 말').length).toBeGreaterThan(0);
  expect(screen.queryByText('다음엔 이렇게 해 봐요')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이어서 하기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
});

test('받기 전에는 지난번에 코칭 구역을 그렸을 때만 같은 모양의 뼈대를 보이고, 못 받으면 다시 시도 줄을 둔다', async () => {
  const first = await show(null);
  expect(screen.queryByText('최근 코칭')).not.toBeOnTheScreen();
  await first.unmount();

  rememberSkeletonHints({ coaching: 'next', coachingRows: 2 });
  const second = await show(null);
  expect(screen.getByText('최근 코칭')).toBeOnTheScreen();
  await second.unmount();

  const onRetry = jest.fn();
  await show(null, true, onRetry);
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(onRetry).toHaveBeenCalled();
});

describe('진행 횟수·태그·영상 길이(SOMA-810)', () => {
  const withDuration = (r: PracticeRound, ms: number | null) => ({ ...r, video_duration_ms: ms }) as PracticeRound;

  test('값이 있으면 장면 카드에 「n/3번 해 봤어요」와 채운 점 n개, 최근 코칭 줄에 태그 칩과 영상 길이', async () => {
    await show([
      group({
        title: '이별 장면',
        practice_count: 2,
        practice_goal: 3,
        tags: ['emotion_memory', 'resolved', 'unknown'],
        practices: [withDuration(round('p1', '2026-10-01T00:00:00Z', true), 72_000)],
      }),
    ]);

    expect(screen.getByText('2/3번 해 봤어요')).toBeOnTheScreen();
    expect(screen.getAllByTestId('coaching-progress-dot-on')).toHaveLength(2);
    expect(screen.getAllByTestId('coaching-progress-dot-off')).toHaveLength(1);
    expect(screen.getAllByTestId('coaching-recent-tag').map((n) => n.props.children)).toEqual(['감정 기억', '해결']);
    expect(screen.getByTestId('coaching-recent-duration')).toHaveTextContent('1:12');
  });

  test('3을 넘으면 점 3개를 다 채우고 글은 「n번 해 봤어요」', async () => {
    await show([group({ practice_count: 5, practice_goal: 3, practices: [round('p1', '2026-10-01T00:00:00Z', true)] })]);
    expect(screen.getByText('5번 해 봤어요')).toBeOnTheScreen();
    expect(screen.getAllByTestId('coaching-progress-dot-on')).toHaveLength(3);
    expect(screen.queryByTestId('coaching-progress-dot-off')).not.toBeOnTheScreen();
  });

  test.each([
    ['필드 없음(서버 스위치 꺼짐)', {}, round('p1', '2026-10-01T00:00:00Z', true)],
    ['null(옛 연습)', { practice_count: null, tags: [] }, withDuration(round('p1', '2026-10-01T00:00:00Z', true), null)],
  ])('값이 %s이면 진행 글·점·태그·길이를 모두 숨긴다', async (_name, extra, practice) => {
    await show([group({ ...extra, practices: [practice] })]);
    expect(screen.queryByTestId('coaching-progress')).not.toBeOnTheScreen();
    expect(screen.queryByText(/번 해 봤어요/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('coaching-recent-tag')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('coaching-recent-duration')).not.toBeOnTheScreen();
  });
});
