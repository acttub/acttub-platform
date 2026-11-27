import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import ProfileScreen from '@/app/(tabs)/profile';
import { setFirstTimeState } from '@/lib/practice/first-time';
import { api } from '@/lib/api';
import { resetLastReads } from '@/lib/last-reads';

type Me = {
  profile: {
    name?: string | null;
    photo_url?: string | null;
    bio?: string | null;
    goal?: string | null;
    experience?: string | null;
  } | null;
} | null;

const mockRouter = { push: jest.fn(), navigate: jest.fn() };
let mockUser: { email: string | null } | null = { email: 'actor@example.com' };
let mockMe: Me = null;
let mockFocusEffect: () => (() => void) | void = () => undefined;
let mockCleanup: (() => void) | void;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => (() => void) | void) => {
      mockFocusEffect = effect;
      useEffect(() => {
        mockCleanup = effect();
        return () => mockCleanup?.();
      }, [effect]);
    },
  };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
// 친구 초대 칸(SOMA-865)은 tests/components/invite-card 가 본다. 여기 useFocusEffect 목은 마지막 등록 하나만 기억해 칸을 뺀다.
jest.mock('@/components/invite-card', () => ({
  InviteCard: () => {
    const { View } = require('react-native');
    return <View testID="profile-invite" />;
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser, profile: { me: mockMe } }) }));
// 머리 알림 종(SOMA-1120)이 읽는 안 읽은 알림 수.
jest.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ count: 0, badge: null }) }));
// 이번 주 연습 기록은 탭 레이아웃의 공급자가 받는다(tests/screens/tab-launch). 여기서는 받은 값을 그대로 그리는지만 본다.
const mockRecords = {
  activityLoaded: false,
  weekDays: [] as { key: string; label: string; isToday: boolean; count: number }[],
  weekPracticedDays: 0,
  totalDays: 0,
  refresh: jest.fn(async () => undefined),
};
jest.mock('@/hooks/use-practice-records', () => ({ usePracticeRecords: () => mockRecords }));
jest.mock('@/lib/api', () => ({
  api: {
    listPracticeGroups: jest.fn(),
    listMyChallengeEntries: jest.fn(),
    listReadingScripts: jest.fn(),
    listReadingSessions: jest.fn(),
    listSavedEntries: jest.fn(),
    getPracticeNote: jest.fn(),
  },
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const listGroups = api.listPracticeGroups as jest.Mock;
const listEntries = api.listMyChallengeEntries as jest.Mock;
const listScripts = api.listReadingScripts as jest.Mock;
const listSessions = api.listReadingSessions as jest.Mock;
const listSaved = api.listSavedEntries as jest.Mock;
const getNote = api.getPracticeNote as jest.Mock;

// 이번 달·지난달 시각 — 「이번 달 연습」은 기기 시각 기준 달력 달로 센다.
const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString();

const entry = (id: string, challengeId: string, created_at = thisMonth, extra: Record<string, unknown> = {}) => ({
  id,
  created_at,
  like_count: 2,
  visibility: 'public',
  challenge: { id: challengeId, line: `대사 ${challengeId}` },
  ...extra,
});
// 연습 1회 = 노트가 생긴 코칭 회차(SOMA-773). 회차는 기본으로 노트가 있고, 대화만 하다 나간 회차는 noNote(시각)로 만든다.
type Round = string | { at: string; note: null };
const noNote = (at: string): Round => ({ at, note: null });
const group = (root_id: string, practiceTimes: Round[], extra: Record<string, unknown> = {}) => ({
  root_id,
  hidden_at: null,
  title: `연습 ${root_id}`,
  practices: practiceTimes.map((round, i) => ({
    id: `${root_id}-${i}`,
    created_at: typeof round === 'string' ? round : round.at,
    note: typeof round === 'string' ? { id: `note-${root_id}-${i}` } : null,
    scene: { situation: '' },
  })),
  ...extra,
});

/** 다른 화면에 갔다가 프로필 탭으로 돌아온다. */
async function refocus() {
  await act(async () => {
    mockCleanup?.();
    mockCleanup = mockFocusEffect();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { email: 'actor@example.com' };
  mockMe = null;
  getItem.mockResolvedValue(null);
  listGroups.mockResolvedValue({ groups: [] });
  listEntries.mockResolvedValue({ entries: [], next_cursor: null });
  listScripts.mockResolvedValue({ scripts: [] });
  listSessions.mockResolvedValue({ sessions: [] });
  listSaved.mockResolvedValue({ entries: [] });
  getNote.mockRejectedValue(new Error('no note'));
});

test('서버 프로필의 이름·사진·목표와 경력·소개를 보이고, 이번 달 노트 생긴 코칭 회차·완료한 리딩 회차·올린 참여작 수를 센다', async () => {
  mockMe = {
    profile: { name: '김배우', photo_url: 'https://cdn/photo.jpg', bio: '  무대가 좋은 배우  ', goal: 'audition', experience: 'y1_to_3' },
  };
  getItem.mockResolvedValue('기기 이름');
  // 코칭: 이번 달 노트 회차 4개(노트 없는 회차·지난달 회차는 빼고).
  listGroups.mockResolvedValue({
    groups: [group('g1', [thisMonth, thisMonth, lastMonth, noNote(thisMonth)]), group('g2', [thisMonth, thisMonth])],
  });
  listEntries
    .mockResolvedValueOnce({ entries: [entry('e1', 'c1'), entry('e2', 'c2')], next_cursor: 'n1' })
    .mockResolvedValueOnce({ entries: [entry('e3', 'c2'), entry('e4', 'c3', lastMonth)], next_cursor: null });
  listScripts.mockResolvedValue({ scripts: [{ id: 's1', last_practiced_at: thisMonth }, { id: 's2', last_practiced_at: lastMonth }] });
  // 리딩: 이번 달 completed 회차 1개(끝까지 안 간 회차·지난달 회차는 빼고).
  listSessions.mockResolvedValue({
    sessions: [
      { status: 'completed', started_at: thisMonth },
      { status: 'in_progress', started_at: thisMonth },
      { status: 'completed', started_at: lastMonth },
    ],
  });

  await render(<ProfileScreen />);

  // 챌린지: 이번 달 참여작 3개 — 같은 챌린지(c2)에 두 번 올린 것도 2회로 센다.
  expect(await screen.findByText('이달 마친 연습')).toBeOnTheScreen();
  expect(screen.getByText('8')).toBeOnTheScreen();
  expect(screen.getByText('4')).toBeOnTheScreen();
  expect(screen.getByText('1')).toBeOnTheScreen();
  expect(screen.getByText('3')).toBeOnTheScreen();
  expect(listGroups).toHaveBeenCalledWith('all');
  expect(listEntries.mock.calls).toEqual([
    [undefined, undefined],
    [undefined, 'n1'],
  ]);
  // 리딩 회차는 이번 달에 연습한 대본만 읽는다.
  expect(listSessions.mock.calls).toEqual([['s1']]);
  expect(screen.getByText('김배우')).toBeOnTheScreen();
  expect(screen.queryByText('기기 이름')).not.toBeOnTheScreen();
  expect(screen.queryByText('김')).not.toBeOnTheScreen();
  expect(screen.getByText('무대가 좋은 배우')).toBeOnTheScreen();
  expect(screen.queryByText('코치가 기억하는 것')).not.toBeOnTheScreen();
});

test('서버 이름을 아직 못 읽었으면 기기에 적어 둔 이름을 쓰고 사진 자리는 기본 얼굴(pen P/DefaultAvatar)이며, 소개가 비면 안내 문구를 보인다', async () => {
  mockMe = { profile: { name: null, photo_url: null, bio: '   ' } };
  getItem.mockResolvedValue('  민지  ');

  await render(<ProfileScreen />);

  expect(await screen.findByText('민지')).toBeOnTheScreen();
  expect(screen.getByTestId('default-avatar')).toBeOnTheScreen();
  expect(screen.queryByText('민')).not.toBeOnTheScreen();
  expect(screen.getByText('이달 마친 연습')).toBeOnTheScreen();
  expect(screen.getAllByText('0')).toHaveLength(4);
  expect(screen.getByText('한 줄 소개를 적어 보세요')).toBeOnTheScreen();
});

test('이름이 어디에도 없으면 이메일 앞부분으로 부른다', async () => {
  mockUser = { email: 'kim.actor99@example.com' };
  getItem.mockResolvedValue('   ');

  await render(<ProfileScreen />);

  expect(await screen.findByText('kim actor')).toBeOnTheScreen();
  expect(screen.getByTestId('default-avatar')).toBeOnTheScreen();
});

test('이름도 이메일도 없으면 화면 제목으로 부른다', async () => {
  mockUser = null;
  getItem.mockRejectedValue(new Error('keychain locked'));

  await render(<ProfileScreen />);

  await waitFor(() => expect(screen.getAllByText('프로필')).toHaveLength(2));
  expect(screen.getByTestId('default-avatar')).toBeOnTheScreen();
  expect(screen.queryByText(/@/)).not.toBeOnTheScreen();
});

test('목록을 못 읽으면 숫자는 뼈대로 두고 다시 시도 상자를 보이며, 다시 시도하면 다시 받는다', async () => {
  listGroups.mockRejectedValue(new Error('down'));
  listEntries.mockRejectedValue(new Error('down'));
  listScripts.mockRejectedValue(new Error('down'));
  listSaved.mockRejectedValue(new Error('down'));
  resetLastReads();

  await render(<ProfileScreen />);

  expect(await screen.findByText('목록을 불러오지 못했어요')).toBeOnTheScreen();
  expect(screen.queryByText('아직 연습 기록이 없어요')).not.toBeOnTheScreen();
  expect(listEntries).toHaveBeenCalledTimes(1);
  expect(screen.queryAllByText('0')).toHaveLength(0);

  listGroups.mockResolvedValue({ groups: [] });
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  expect(await screen.findByText('아직 연습 기록이 없어요')).toBeOnTheScreen();
  expect(listGroups).toHaveBeenCalledTimes(2);
});

test('다른 화면에서 돌아오면 다시 세고, 떠나기 전 늦게 온 응답은 새 값을 덮지 않는다', async () => {
  let resolveOldGroups: (value: unknown) => void = () => undefined;
  let resolveOldEntries: (value: unknown) => void = () => undefined;
  let resolveOldName: (value: unknown) => void = () => undefined;
  listGroups.mockImplementationOnce(() => new Promise((resolve) => (resolveOldGroups = resolve)));
  listEntries.mockImplementationOnce(() => new Promise((resolve) => (resolveOldEntries = resolve)));
  getItem.mockImplementationOnce(() => new Promise((resolve) => (resolveOldName = resolve)));

  await render(<ProfileScreen />);

  listGroups.mockResolvedValue({ groups: [group('g1', [thisMonth, thisMonth, thisMonth, thisMonth])] });
  listEntries.mockResolvedValue({ entries: [entry('e1', 'c1')], next_cursor: null });
  getItem.mockResolvedValue('새 이름');
  await refocus();
  expect(await screen.findByText('5')).toBeOnTheScreen();
  expect(screen.getByText('새 이름')).toBeOnTheScreen();

  await act(async () => {
    resolveOldGroups({ groups: [group('g9', Array(9).fill(thisMonth))] });
    resolveOldEntries({ entries: [entry('e1', 'c1'), entry('e2', 'c2')], next_cursor: 'more' });
    resolveOldName('옛 이름');
  });

  expect(screen.getAllByText('5').length).toBeGreaterThan(0);
  expect(screen.getByText('새 이름')).toBeOnTheScreen();
  expect(screen.queryByText('옛 이름')).not.toBeOnTheScreen();
  // 떠난 뒤에는 다음 쪽을 더 읽지 않는다.
  expect(listEntries).toHaveBeenCalledTimes(2);
});

test('설정·편집으로 보내고, 탭을 바꾸면 그 카드와 전체 보기로 간다', async () => {
  listGroups.mockResolvedValue({ groups: Array.from({ length: 7 }, (_, i) => group(`g${i}`, [thisMonth])) });
  listEntries.mockResolvedValue({ entries: [entry('e1', 'c1', thisMonth, { visibility: 'private' })], next_cursor: null });
  listSaved.mockResolvedValue({
    entries: [{ id: 's1', caption: ' ', like_count: 5, author: { name: '이배우' } }],
  });
  await render(<ProfileScreen />);
  await screen.findByText('actor');

  // 머리 톱니와 맨 아래 설정 줄(SOMA-1123)이 같은 곳으로 간다 — 여기서는 머리 톱니.
  await fireEvent.press(screen.getAllByRole('button', { name: '설정' })[0]);
  await fireEvent.press(screen.getByText('편집'));
  // 「코치가 기억하는 것」 바로가기는 뺐다(10/25) — 기억은 배우에게 보여 주지 않는다.
  expect(screen.queryByText('코치가 기억하는 것')).not.toBeOnTheScreen();
  await fireEvent.press(await screen.findByText('전체 보기'));

  await fireEvent.press(screen.getByRole('tab', { name: '참여작' }));
  // pen S14.4 — 썸네일 아래 「“대사”」, 하트 수 · 나만 보기.
  expect(screen.getByText('· 나만 보기')).toBeOnTheScreen();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('button', { name: '“대사 c1”' }));
  await fireEvent.press(screen.getByText('전체 보기'));

  await fireEvent.press(screen.getByRole('tab', { name: '저장됨' }));
  // pen S14.5 — 하트 수 · 작성자.
  expect(screen.getByText('· 이배우')).toBeOnTheScreen();
  expect(screen.getByText('5')).toBeOnTheScreen();
  expect(screen.queryByText('전체 보기')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이배우' }));

  expect(mockRouter.push.mock.calls).toEqual([
    ['/settings'],
    ['/profile-edit'],
    ['/history'],
    ['/challenge-entries'],
    ['/challenge-entries'],
    [{ pathname: '/challenge-play', params: { entryId: 's1' } }],
  ]);
});

test('순서는 내 카드 → 이번 주 연습 → 이번 달 숫자 → 연습 기록 → 참여작·저장됨 → 친구 초대 → 설정이다(SOMA-1123)', async () => {
  mockMe = { profile: { name: '하늘' } };
  await render(<ProfileScreen />);
  await act(async () => undefined);

  const hosts = screen.container.queryAll((node) => typeof node.type === 'string');
  const at = (el: unknown) => hosts.indexOf(el as (typeof hosts)[number]);
  const order = [
    at(screen.getByText('하늘')),
    at(screen.getByTestId('home-week')),
    at(screen.getByTestId('profile-month')),
    at(screen.getByRole('tab', { name: '연습 기록' })),
    at(screen.getByRole('tab', { name: '참여작' })),
    at(screen.getByRole('tab', { name: '저장됨' })),
    at(screen.getByTestId('profile-invite')),
    at(screen.getByTestId('profile-settings-row')),
  ];
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  await fireEvent.press(within(screen.getByTestId('profile-settings-row')).getByRole('button', { name: '설정' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/settings');
});

describe('예전 홈에서 옮겨 온 것(SOMA-1120)', () => {
  afterEach(() => {
    setFirstTimeState('unknown');
    mockRecords.activityLoaded = false;
    mockRecords.weekDays = [];
  });

  test('머리 오른쪽에 알림 종과 설정을 두고, 첫 사용자여도 홈으로 가는 꺾쇠는 두지 않는다', async () => {
    setFirstTimeState('first');
    await render(<ProfileScreen />);
    await act(async () => undefined);

    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
    const bell = screen.getByRole('button', { name: '알림함' });
    expect(bell.props['ph-label']).toBe('profile_bell');
    await fireEvent.press(bell);
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  test('이번 주 연습 카드는 받기 전엔 원 자리만 뼈대이고, 받으면 이번 주·누적 일수와 그날 횟수를 보인다', async () => {
    const view = await render(<ProfileScreen />);
    await act(async () => undefined);
    expect(screen.getByTestId('home-week')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-days-summary')).not.toBeOnTheScreen();

    mockRecords.activityLoaded = true;
    mockRecords.weekPracticedDays = 1;
    mockRecords.totalDays = 4;
    mockRecords.weekDays = ['월', '화', '수', '목', '금', '토', '일'].map((label, i) => ({ key: `d${i}`, label, isToday: i === 6, count: i === 6 ? 2 : 0 }));
    await view.rerender(<ProfileScreen />);
    expect(screen.getByText('이번 주 1일 · 누적 4일')).toBeOnTheScreen();
    expect(screen.getByLabelText('오늘 연습 2번')).toBeOnTheScreen();
    expect(screen.getAllByTestId('home-week-empty')).toHaveLength(6);
  });

  test('맨 위에서 당기면 이번 주 연습 기록과 아래 목록을 같이 다시 받는다', async () => {
    await render(<ProfileScreen />);
    await act(async () => undefined);
    const calls = listGroups.mock.calls.length;
    const control = screen.container.queryAll((node) => node.props.refreshControl !== undefined)[0].props.refreshControl;
    await act(async () => control.props.onRefresh());
    expect(mockRecords.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listGroups.mock.calls.length).toBeGreaterThan(calls));
  });
});
