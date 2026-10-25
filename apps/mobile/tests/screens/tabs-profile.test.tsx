import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import ProfileScreen from '@/app/(tabs)/profile';
import { setFirstTimeState } from '@/lib/practice/first-time';
import { api } from '@/lib/api';

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
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser, profile: { me: mockMe } }) }));
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
  expect(await screen.findByText('이번 달 연습')).toBeOnTheScreen();
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
  expect(screen.getByText('이번 달 연습')).toBeOnTheScreen();
  expect(screen.getAllByText('0')).toHaveLength(4);
  expect(screen.getByText('한 줄 소개를 적어보세요')).toBeOnTheScreen();
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

test('목록을 못 읽으면 0으로 두고 빈 안내를 보인다', async () => {
  listGroups.mockRejectedValue(new Error('down'));
  listEntries.mockRejectedValue(new Error('down'));
  listScripts.mockRejectedValue(new Error('down'));
  listSaved.mockRejectedValue(new Error('down'));

  await render(<ProfileScreen />);

  expect(await screen.findByText('아직 연습 기록이 없어요.')).toBeOnTheScreen();
  expect(listEntries).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('0')).toHaveLength(4);
  expect(screen.queryByText(/개$/)).not.toBeOnTheScreen();
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

  await fireEvent.press(screen.getByRole('button', { name: '설정' }));
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

describe('첫 사용자라 탭바가 숨으면', () => {
  afterEach(() => setFirstTimeState('unknown'));

  test('머리에 홈으로 돌아가는 꺾쇠를 둔다', async () => {
    setFirstTimeState('first');
    await render(<ProfileScreen />);
    await act(async () => undefined);

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back.props['ph-label']).toBe('profile_back_home');
    await fireEvent.press(back);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/');
  });

  test('탭바가 보이면(연습했거나 아직 모르면) 꺾쇠를 두지 않는다', async () => {
    setFirstTimeState('practiced');
    await render(<ProfileScreen />);
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();

    await act(async () => setFirstTimeState('unknown'));
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeOnTheScreen();
  });
});
