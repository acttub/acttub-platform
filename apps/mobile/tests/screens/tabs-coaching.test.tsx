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

const listPracticeGroups = api.listPracticeGroups as jest.Mock;

beforeEach(() => {
  mockListScripts.mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
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

test('노트가 있는 묶음이 없으면(1턴만 하고 나감) 처음 화면 — 말풍선과 입구 셋, 고르기 전에는 「다음」이 막혀 있다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('어떻게 코칭 받을래요?')).toBeOnTheScreen();
  expect(screen.getByText('하나 고르고 「다음」을 누르세요.')).toBeOnTheScreen();
  expect(screen.getByText('찍어 둔 영상이나 지금 찍은 영상으로')).toBeOnTheScreen();
  expect(screen.queryByText('코칭은 이렇게 해요')).not.toBeOnTheScreen();
  expect(getPracticeNote).not.toHaveBeenCalled();

  // 기본 선택 없음 — 누르기만 해서는 넘어가지 않고, 「다음」도 막혀 있다.
  const next = screen.getByRole('button', { name: '다음' });
  expect(next.props.accessibilityState?.disabled ?? next.props['aria-disabled']).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: '영상 보여 주고 코칭 받기' }));
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: '영상 보여 주고 코칭 받기' }).props.accessibilityState.selected).toBe(true);

  // 영상 보여 주고 — 새 연습 준비(목적 → 영상). 첫 코칭이라 파란 안내를 켠다.
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: { first: '1' } });
  // 영상 없이 말로 — 목적 화면으로(SOMA-745).
  await fireEvent.press(screen.getByRole('radio', { name: '영상 없이 말로 코칭 받기' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/talk');
  // 찍을 대사부터 — 리딩 영역 화면으로 연결만 한다.
  await fireEvent.press(screen.getByRole('radio', { name: '찍을 대사부터 같이 만들기' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/script-cocreate');
});

test('노트가 있는 묶음이 있으면 입구 목록 다섯 줄을 보이고 각 줄이 제자리로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('오늘은 어떤 걸 해 볼까요?')).toBeOnTheScreen();
  expect(screen.queryByText('하던 코칭 이어 하기')).not.toBeOnTheScreen();
  expect(screen.getByText('지난 코칭 영상·대화·일지')).toBeOnTheScreen();
  const go = async (name: string) => {
    mockRouter.push.mockClear();
    await fireEvent.press(screen.getByRole('button', { name }));
  };
  await go('새 영상으로 코칭 받기');
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: {} });
  await go('이전 코칭 이어 하기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
  await go('영상 없이 말로 코칭 받기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/talk');
  await go('찍을 대사부터 같이 만들기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/script-cocreate');
  await go('연습 기록 보기');
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
});

test('저장한 대본이 있으면 「내 대본으로 찍기」 줄이 생기고 대본 고르기 화면으로 간다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [{ id: 's1' }], total_count: 1, in_progress_count: 0 });
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);

  await fireEvent.press(await screen.findByRole('button', { name: '내 대본으로 찍기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/coach-scripts');
});

test('저장한 대본이 없으면 「내 대본으로 찍기」 줄은 없다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ title: '이별 장면', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);
  expect(await screen.findByText('오늘은 어떤 걸 해 볼까요?')).toBeOnTheScreen();
  expect(screen.queryByText('내 대본으로 찍기')).not.toBeOnTheScreen();
});

test('대화 중인 묶음이 있으면 맨 위 「하던 코칭 이어 하기」가 그 회차의 액티 화면으로 바로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ root_id: 'open', title: '카페, 헤어지자는 말', in_progress_practice_id: 'open-1', practices: [round('open-1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('하던 코칭이 있어요. 이어서 할까요?')).toBeOnTheScreen();
  expect(screen.getByText('카페, 헤어지자는 말')).toBeOnTheScreen();
  expect(screen.queryByText('어떻게 코칭 받을래요?')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '하던 코칭 이어 하기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
});

test('탭바가 보이면 하단 탭으로 홈에 가므로 뒤로 꺾쇠를 두지 않는다(10/22 피드백)', async () => {
  listPracticeGroups.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);
  await screen.findByText('어떻게 코칭 받을래요?');

  expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
});

describe('첫 사용자라 탭바가 숨으면', () => {
  afterEach(() => setFirstTimeState('unknown'));

  test('처음 화면 머리 오른쪽에 설정 버튼을 둔다 — 탭바가 없어도 로그아웃·탈퇴로 갈 수 있다', async () => {
    setFirstTimeState('first');
    listPracticeGroups.mockResolvedValue({ groups: [] });
    await render(<CoachingTab />);
    await screen.findByText('어떻게 코칭 받을래요?');

    const gear = screen.getByRole('button', { name: '설정' });
    expect(gear.props['ph-label']).toBe('coaching_first_settings');
    await fireEvent.press(gear);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');

    // 탭바가 없으니 꺾쇠로 홈(뭐부터 해 볼까요?)에 돌아가 다른 길을 고를 수 있다.
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/');
  });

  test('탭바가 보이면(시작했거나 아직 모르면) 설정 버튼을 두지 않는다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [] });
    setFirstTimeState('practiced');
    await render(<CoachingTab />);
    await screen.findByText('어떻게 코칭 받을래요?');
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();

    await act(async () => setFirstTimeState('unknown'));
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();
  });
});
