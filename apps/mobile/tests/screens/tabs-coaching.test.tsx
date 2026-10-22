import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoachingTab from '@/app/(tabs)/coaching';
import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';
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

test('노트가 있는 묶음이 없으면(1턴만 하고 나감) 처음 화면 — 말풍선·고정 예시 대화와 두 버튼을 보인다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('코칭이 처음이죠?')).toBeOnTheScreen();
  expect(screen.getByText('코칭은 이렇게 해요')).toBeOnTheScreen();
  expect(screen.getByText('「갈매기」 니나 · 1분 12초')).toBeOnTheScreen();
  expect(screen.getByText('인정받고 싶었던 것 같아요')).toBeOnTheScreen();
  expect(screen.getByText('정답을 주기보다, 질문하며 고칠 점 하나를 같이 찾아요')).toBeOnTheScreen();
  expect(screen.queryByText('저번 코치 메모')).not.toBeOnTheScreen();
  expect(getPracticeNote).not.toHaveBeenCalled();

  // 지금 찍기 — 찍는 법 → 카메라 → 새 연습 준비(next=upload). 첫 코칭이라 파란 안내를 켠다.
  await fireEvent.press(screen.getByRole('button', { name: '지금 찍어서 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/record-guide', params: { next: 'upload', first: '1' } });
  // 찍어 둔 영상 — 새 연습 준비로 바로.
  await fireEvent.press(screen.getByRole('button', { name: '찍어 둔 영상 올리기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: { first: '1' } });
});

test('노트가 있는 가장 최근 묶음의 다음 테이크 문장을 저번 코치 메모로 띄우고, 노트 없이 나간 더 최근 묶음은 건너뛴다', async () => {
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
  expect(screen.getByText('저번 코치 메모')).toBeOnTheScreen();
  expect(screen.getByText('다음엔 이렇게 해 봐요')).toBeOnTheScreen();
  expect(screen.getByText(/^10월 1일 · 이별 장면$/)).toBeOnTheScreen();
  expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();
  // 서버에 없는 값(몇 번 해 봤는지)은 그리지 않는다.
  expect(screen.queryByText(/번 해 봤어요/)).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '한 번 더 연습' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'noted', practiceId: 'p1' });
  expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
});

test('타일 둘(새 영상·지난 코칭 N개)과 최근 코칭 두 줄을 보이고, 전체 보기는 기록으로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [
      group({ root_id: 'a', title: '첫 장면', last_practiced_at: '2026-10-03T00:00:00Z', practices: [round('p1', '2026-10-03T00:00:00Z', true)] }),
      group({ root_id: 'b', title: '둘째 장면', last_practiced_at: '2026-10-02T00:00:00Z', practices: [round('p2', '2026-10-02T00:00:00Z', false)] }),
      group({ root_id: 'c', title: '셋째 장면', last_practiced_at: '2026-10-01T00:00:00Z', practices: [round('p3', '2026-10-01T00:00:00Z', false)] }),
      group({ root_id: 'h', title: '숨긴 장면', hidden_at: '2026-10-04T00:00:00Z', practices: [round('p4', '2026-10-04T00:00:00Z', true)] }),
    ],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('날짜별 기록 3개')).toBeOnTheScreen();
  expect(screen.getByText('최근 코칭')).toBeOnTheScreen();
  expect(screen.getByText('둘째 장면')).toBeOnTheScreen();
  expect(screen.queryByText('셋째 장면')).not.toBeOnTheScreen();
  expect(screen.queryByText('숨긴 장면')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '새 영상으로 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/upload', params: {} });
  await fireEvent.press(screen.getByRole('button', { name: '지난 코칭 다시 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
  mockRouter.push.mockClear();
  await fireEvent.press(screen.getByText('전체 보기'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
});

test('대화 중인 묶음이면 버튼이 「이어서 하기」이고 그 회차의 코치 화면으로 바로 간다(분석 대기도 코치 화면 안이다)', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ root_id: 'noted', in_progress_practice_id: 'open-1', practices: [round('p1', '2026-10-01T00:00:00Z', true)] })],
  });
  await render(<CoachingTab />);

  await fireEvent.press(await screen.findByRole('button', { name: '이어서 하기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
  expect(setContinueOrigin).not.toHaveBeenCalled();
});

test('노트 없이 나간 대화만 있으면 「코칭이 처음이죠?」 대신 「하던 코칭 · 이어서 하기」를 띄운다(10/20 피드백)', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ root_id: 'open', in_progress_practice_id: 'open-1', practices: [round('open-1', '2026-10-01T00:00:00Z', false)] })],
  });
  await render(<CoachingTab />);

  expect(await screen.findByText('하던 코칭')).toBeOnTheScreen();
  expect(screen.getByText('코치와 하던 대화가 남아 있어요.')).toBeOnTheScreen();
  expect(screen.queryByText('코칭이 처음이죠?')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이어서 하기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
});

test('다음 테이크 문장을 못 받으면 그 칸 없이 날짜·장면 제목만 둔다', async () => {
  listPracticeGroups.mockResolvedValue({ groups: [group({ practices: [round('p1', '2026-10-01T00:00:00Z', true)] })] });
  getPracticeNote.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);

  expect(await screen.findByText(/^10월 1일 · 카페 장면$/)).toBeOnTheScreen();
  await waitFor(() => expect(getPracticeNote).toHaveBeenCalled());
  expect(screen.queryByText('다음엔 이렇게 해 봐요')).not.toBeOnTheScreen();
  expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();
});

test('탭바가 보이면 하단 탭으로 홈에 가므로 뒤로 꺾쇠를 두지 않는다(10/22 피드백)', async () => {
  listPracticeGroups.mockRejectedValue(new Error('down'));
  await render(<CoachingTab />);
  await screen.findByText('코칭이 처음이죠?');

  expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
});

describe('첫 사용자라 탭바가 숨으면', () => {
  afterEach(() => setFirstTimeState('unknown'));

  test('「코칭이 처음이죠?」 머리 오른쪽에 설정 버튼을 둔다 — 탭바가 없어도 로그아웃·탈퇴로 갈 수 있다', async () => {
    setFirstTimeState('first');
    listPracticeGroups.mockResolvedValue({ groups: [] });
    await render(<CoachingTab />);
    await screen.findByText('코칭이 처음이죠?');

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
    await screen.findByText('코칭이 처음이죠?');
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();

    await act(async () => setFirstTimeState('unknown'));
    expect(screen.queryByRole('button', { name: '설정' })).not.toBeOnTheScreen();
  });
});
