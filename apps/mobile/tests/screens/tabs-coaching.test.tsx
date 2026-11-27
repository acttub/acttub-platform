import { act, fireEvent, render, screen } from '@testing-library/react-native';

import CoachingTab from '@/app/(tabs)/coaching';
import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';
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
const mockListScripts = jest.fn();
jest.mock('@/lib/reading/store', () => ({ listScripts: () => mockListScripts() }));
// 영상 올리는 중 카드(예전 홈 맨 위, SOMA-1120) — 카드 자체는 tests/components/home-upload-card 가 본다.
const mockWaiting = { card: null as null | { state: 'uploading'; waiting: { scene: { situation: string } } }, error: null, busy: false, retry: jest.fn(), begin: jest.fn() };
jest.mock('@/hooks/use-waiting-upload', () => ({ useWaitingUpload: () => mockWaiting }));

const listPracticeGroups = api.listPracticeGroups as jest.Mock;

beforeEach(() => {
  mockListScripts.mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
  mockWaiting.card = null;
});

test('영상을 올리는 중이면 맨 위에 그 카드를 둔다 — 코칭 이어 하기(SOMA-1120, 예전 홈)', async () => {
  mockWaiting.card = { state: 'uploading', waiting: { scene: { situation: '카페 이별 장면' } } };
  listPracticeGroups.mockResolvedValue({ groups: [] });
  await render(<CoachingTab />);
  await screen.findByText('코칭이 처음이죠?');
  expect(screen.getByTestId('home-upload-card')).toBeOnTheScreen();
  expect(screen.getByText('카페 이별 장면')).toBeOnTheScreen();
});
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

beforeEach(() => {
  jest.clearAllMocks();
  getPracticeNote.mockResolvedValue({ next_take: null, report: null });
});

test('노트가 있는 묶음이 없으면(1턴만 하고 나감) 처음 화면 — 소개 말풍선·예시 대화·시작 버튼 하나(SOMA-842)', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('코칭이 처음이죠?')).toBeOnTheScreen();
  expect(screen.getByText('코칭은 이렇게 해요')).toBeOnTheScreen();
  expect(screen.getByText('인정받고 싶었던 것 같아요')).toBeOnTheScreen();
  expect(getPracticeNote).not.toHaveBeenCalled();

  // 찍기·올리기가 같은 곳으로 가서 시작 버튼은 하나다 — 새 연습 준비(목적 → 영상).
  expect(screen.queryByRole('button', { name: '지금 찍어서 코칭 받기' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '찍어 둔 영상 올리기' })).not.toBeOnTheScreen();
  const start = screen.getByRole('button', { name: '영상 보여 주고 코칭 받기' });
  expect(start.props['ph-label']).toBe('coaching_first_next');
  await fireEvent.press(start);
  // 첫 코칭은 목적을 묻지 않는 새 연습으로 간다(SOMA-984).
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: { first: '1' } });
  // 본문에 「대사 같이 만들기」 카드가 없고, 보조 길 둘은 아래 링크 줄이다(SOMA-984).
  expect(screen.queryByText('대사가 없으면 액티랑 같이')).not.toBeOnTheScreen();
  expect(screen.getByText('영상 없이 말로')).toBeOnTheScreen();
  expect(screen.getByText('대사부터 같이 만들기')).toBeOnTheScreen();
  // 영상 없이 말로 — 목적 화면으로(SOMA-745).
  await fireEvent.press(screen.getByRole('button', { name: '영상 없이 말로 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/talk');
  // 찍을 대사부터 — 리딩 영역 화면으로 연결만 한다.
  await fireEvent.press(screen.getByRole('button', { name: '찍을 대사부터 같이 만들기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/script-cocreate');
});

test('노트가 있는 묶음이 있으면 저번 코치 메모 카드와 입구들을 보이고 각 입구가 제자리로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('저번 코치 메모')).toBeOnTheScreen();
  expect(screen.queryByText('하던 코칭')).not.toBeOnTheScreen();
  expect(screen.getByText('최근 코칭')).toBeOnTheScreen();
  const go = async (name: string) => {
    mockRouter.push.mockClear();
    await fireEvent.press(screen.getByRole('button', { name }));
  };
  await go('새 영상으로 코칭 받기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
  // 「이전 코칭 이어 하기」는 「지난 코칭 다시 보기」와 같은 화면이라 뺐다(10/28).
  expect(screen.queryByRole('button', { name: '이전 코칭 이어 하기' })).not.toBeOnTheScreen();
  // 말로 코칭 · 내 대본 · 대사 같이 만들기는 한 줄로 모아 선택 화면으로 간다(SOMA-984 B안).
  expect(screen.queryByRole('button', { name: '영상 없이 말로 코칭 받기' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '찍을 대사부터 같이 만들기' })).not.toBeOnTheScreen();
  await go('다른 방법으로 코칭 받기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/coach-other');
  // 연습 기록 보기 — 타일 「지난 코칭 다시 보기」 하나다. 같은 화면으로 가던 「최근 코칭 · 전체 보기」는 뺐다(11/2 QA).
  await go('지난 코칭 다시 보기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
  expect(screen.queryByRole('button', { name: '전체 보기' })).not.toBeOnTheScreen();
});

test('순서는 이어 하기(저번 코치 메모) → 새 코칭 → 지난 기록(최근 코칭·연습 기록 화면)이다(SOMA-1123)', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);
  await screen.findByText('저번 코치 메모');

  const hosts = screen.container.queryAll((node) => typeof node.type === 'string');
  const at = (el: unknown) => hosts.indexOf(el as (typeof hosts)[number]);
  const order = [at(screen.getByText('저번 코치 메모')), at(screen.getByRole('button', { name: '새 영상으로 코칭 받기' })), at(screen.getByText('최근 코칭'))];
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('저장한 대본이 있어도 코칭 탭에는 「내 대본으로 찍기」 줄을 따로 두지 않는다(SOMA-984)', async () => {
  mockListScripts.mockResolvedValue({ scripts: [{ id: 's1' }], total_count: 1, in_progress_count: 0 });
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);
  expect(await screen.findByText('저번 코치 메모')).toBeOnTheScreen();
  expect(screen.queryByText('내 대본으로 찍기')).not.toBeOnTheScreen();
});

test('대화 중인 묶음이 있으면 맨 위 「하던 코칭 · 이어서 하기」가 그 회차의 액티 화면으로 바로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ root_id: 'open', title: '카페, 헤어지자는 말', in_progress_practice_id: 'open-1', practices: [round('open-1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('코치와 하던 대화가 남아 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('카페, 헤어지자는 말')).toBeOnTheScreen();
  // 상태 안내에 「다음엔 이렇게 해 봐요」 제목을 붙이지 않고, 같은 뜻의 「이전 코칭 이어 하기」 링크도 두지 않는다(10/26).
  expect(screen.queryByText('다음엔 이렇게 해 봐요')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '이전 코칭 이어 하기' })).not.toBeOnTheScreen();
  expect(screen.queryByText('코칭이 처음이죠?')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이어서 하기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
});

describe('진행 횟수·태그·영상 길이(SOMA-810)', () => {
  const withDuration = (r: PracticeRound, ms: number | null) => ({ ...r, video_duration_ms: ms }) as PracticeRound;

  test('값이 있으면 장면 카드에 「n/3번 해 봤어요」와 채운 점 n개, 최근 코칭 줄에 태그 칩과 영상 길이', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [
        group({
          title: '이별 장면',
          practice_count: 2,
          practice_goal: 3,
          tags: ['emotion_memory', 'resolved', 'unknown'],
          practices: [withDuration(round('p1', '2026-10-01T00:00:00Z', true), 72_000)],
        }),
      ],
    });
    await render(<CoachingTab />);
    await screen.findByText('저번 코치 메모');

    expect(screen.getByText('2/3번 해 봤어요')).toBeOnTheScreen();
    expect(screen.getAllByTestId('coaching-progress-dot-on')).toHaveLength(2);
    expect(screen.getAllByTestId('coaching-progress-dot-off')).toHaveLength(1);
    expect(screen.getAllByTestId('coaching-recent-tag').map((n) => n.props.children)).toEqual(['감정 기억', '해결']);
    expect(screen.getByTestId('coaching-recent-duration')).toHaveTextContent('1:12');
  });

  test('3을 넘으면 점 3개를 다 채우고 글은 「n번 해 봤어요」', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [group({ practice_count: 5, practice_goal: 3, practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
    });
    await render(<CoachingTab />);
    await screen.findByText('저번 코치 메모');

    expect(screen.getByText('5번 해 봤어요')).toBeOnTheScreen();
    expect(screen.getAllByTestId('coaching-progress-dot-on')).toHaveLength(3);
    expect(screen.queryByTestId('coaching-progress-dot-off')).not.toBeOnTheScreen();
  });

  test('하던 코칭 카드에도 같은 진행 표시가 붙는다', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [group({ in_progress_practice_id: 'open-1', practice_count: 1, practices: [round('open-1', '2026-10-01T00:00:00Z', false)] })],
    });
    await render(<CoachingTab />);
    await screen.findByText('코치와 하던 대화가 남아 있어요.');
    expect(screen.getByText('1/3번 해 봤어요')).toBeOnTheScreen();
  });

  test.each([
    ['필드 없음(서버 스위치 꺼짐)', {}, round('p1', '2026-10-01T00:00:00Z', true)],
    ['null(옛 연습)', { practice_count: null, tags: [] }, withDuration(round('p1', '2026-10-01T00:00:00Z', true), null)],
  ])('값이 %s이면 진행 글·점·태그·길이를 모두 숨긴다', async (_name, extra, practice) => {
    listPracticeGroups.mockResolvedValue({ groups: [group({ ...extra, practices: [practice] })] });
    await render(<CoachingTab />);
    await screen.findByText('저번 코치 메모');

    expect(screen.queryByTestId('coaching-progress')).not.toBeOnTheScreen();
    expect(screen.queryByText(/번 해 봤어요/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('coaching-recent-tag')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('coaching-recent-duration')).not.toBeOnTheScreen();
  });
});

test('탭바가 보이면 하단 탭으로 홈에 가므로 뒤로 꺾쇠를 두지 않는다(10/22 피드백)', async () => {
  listPracticeGroups.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);
  // 못 받으면 처음 화면이 아니라 오류 화면이고, 다시 시도하면 다시 읽는다.
  await screen.findByText('연습 기록을 불러오지 못했어요');
  expect(screen.queryByText('코칭이 처음이죠?')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();

  // 다시 받는 동안 버튼이 받는 중으로 바뀌어 눌린 것이 보인다.
  let answer: (value: { groups: PracticeGroup[] }) => void = () => {};
  listPracticeGroups.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(listPracticeGroups).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeBusy();
  await act(async () => answer({ groups: [] }));
  expect(await screen.findByText('코칭이 처음이죠?')).toBeOnTheScreen();
});

describe('첫 사용자', () => {
  afterEach(() => setFirstTimeState('unknown'));

  test('처음 화면 머리 오른쪽에 설정 버튼을 둔다 — 탭바가 없어도 로그아웃·탈퇴로 갈 수 있다', async () => {
    setFirstTimeState('first');
    listPracticeGroups.mockResolvedValue({ groups: [] });
    await render(<CoachingTab />);
    await screen.findByText('코칭이 처음이죠?');

    const gear = screen.getByRole('button', { name: '설정' });
    expect(gear.props['ph-label']).toBe('coaching_first_settings');
    await fireEvent.press(gear);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');

    // 홈 탭이 없어져 탭바가 늘 보인다 — 홈으로 가는 꺾쇠는 두지 않는다(SOMA-1120).
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
  });

  test('탭바가 보이면(시작했거나 아직 모르면) 설정 버튼을 두지 않는다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [] });
    setFirstTimeState('practiced');
    await render(<CoachingTab />);
    await screen.findByText('코칭이 처음이죠?');
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();

    await act(async () => setFirstTimeState('unknown'));
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();
  });
});
