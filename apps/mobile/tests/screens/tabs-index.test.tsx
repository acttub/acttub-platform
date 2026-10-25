import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Platform, ToastAndroid } from 'react-native';

import HomeScreen from '@/app/(tabs)/index';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { SpotlightHost } from '@/components/spotlight-guide';
import { localDate } from '@/lib/admissions';
import { kstDate } from '@/lib/auditions';
import { api } from '@/lib/api';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { ScriptCard } from '@/lib/reading/types';
import { readLastSeenStreak, writeLastSeenStreak } from '@/lib/streak-celebration';
import { currentTutorial, endTutorial, startTutorial } from '@/lib/tutorial';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
// 화면의 useFocusEffect 전부 — 다시 포커스는 모두 다시 부른다.
const mockFocusEffects = new Set<() => void | (() => void)>();
const mockFocusEffect = () => mockFocusEffects.forEach((effect) => effect());
const mockAuth = {
  user: { id: 'u1' } as { id: string } | null,
  consentEntry: { status: 'allowed' },
  profile: { me: null as null | { profile: { experience: string; birth_date: string | null } } },
};

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        mockFocusEffects.add(effect);
        const cleanup = effect();
        return () => {
          mockFocusEffects.delete(effect);
          cleanup?.();
        };
      }, [effect]);
    },
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/api', () => ({
  api: {
    listPracticeGroups: jest.fn(),
    listReadingScripts: jest.fn(),
    listReadingSessions: jest.fn(),
    listChallenges: jest.fn(),
    listMyChallengeEntries: jest.fn(),
    getPracticeNote: jest.fn(),
    admissions: jest.fn(),
    auditions: jest.fn(),
  },
}));
jest.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ count: 0, badge: null }) }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn(async () => null) }));
jest.mock('@/lib/guide-state', () => ({
  hasSeenSpotlight: jest.fn(),
  hasSeenTutorial: jest.fn(),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
  markReadingTutorialSeen: jest.fn(async () => undefined),
}));
jest.mock('@/lib/practice-days', () => ({ rememberPracticeDays: jest.fn() }));
jest.mock('@/lib/streak-celebration', () => ({
  ...jest.requireActual('@/lib/streak-celebration'),
  readLastSeenStreak: jest.fn(),
  writeLastSeenStreak: jest.fn(async () => undefined),
}));
jest.mock('@/components/announcement-poster', () => ({ AnnouncementPoster: jest.fn(() => null) }));

const listPracticeGroups = api.listPracticeGroups as jest.Mock;
const listReadingScripts = api.listReadingScripts as jest.Mock;
const getPracticeNote = api.getPracticeNote as jest.Mock;
/**
 * 연습한 사람(첫 사용자 아님) — 홈이 오늘 할 것·최근 연습·마감 카드를 그린다. 「연습 1회」 기준(SOMA-773)으로도 연습한 날이
 * 있게 사흘 전에 올린 참여작 하나를 둔다(오늘이 아니라 연속 축하는 뜨지 않는다).
 */
const practiced = () => {
  listPracticeGroups.mockResolvedValue({ groups: [group({ title: '카페 장면' })] });
  (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e-old', created_at: isoDaysAgo(3) }], next_cursor: null });
};
const posterProps = () => (AnnouncementPoster as unknown as jest.Mock).mock.calls.at(-1)[0];

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const kstDaysFromNow = (n: number) => kstDate(new Date(Date.now() + n * DAY));
// 홈은 한국 날짜(kstDate)로 마감을 잰다. CI(UTC)에서도 같은 날이 되게 KST 기준 날짜를 만든다.
const localDaysFromNow = kstDaysFromNow;

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

function script(overrides: Partial<ScriptCard>): ScriptCard {
  return {
    id: 's1',
    title: '갈매기',
    my_character_names: [],
    dialogue_count: 10,
    recording_count: 0,
    last_practiced_at: null,
    last_activity_at: '2026-08-10T00:00:00Z',
    status: 'no_cast',
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

function group(overrides: Partial<PracticeGroup>): PracticeGroup {
  return {
    root_id: 'r1',
    title: '카페 장면',
    ordinal_count: 1,
    in_progress_practice_id: null,
    favorite: false,
    hidden_at: null,
    last_practiced_at: '2026-08-15T03:00:00Z',
    poster_url: null,
    practices: [],
    ...overrides,
  };
}

const admissionsPayload = {
  updated_at: '2026-10-01',
  disclaimer: '',
  universities: [
    { id: 'u-a', name: '한국예술종합학교', admission_url: 'https://a', resources: [], tips: [] },
    { id: 'u-b', name: '중앙대학교', admission_url: 'https://b', resources: [], tips: [] },
  ],
  notices: [
    {
      id: 'n-a',
      university_id: 'u-a',
      department: '연기과',
      apply_start: null,
      apply_end: localDaysFromNow(0),
      designated_works: [],
      essay_questions: [],
      stages: [],
      practical_items: [],
      results: [],
    },
    {
      id: 'n-b',
      university_id: 'u-b',
      department: null,
      apply_start: localDaysFromNow(5),
      apply_end: localDaysFromNow(9),
      designated_works: [],
      essay_questions: [],
      stages: [],
      practical_items: [],
      results: [],
    },
  ],
};

const auditionsPayload = {
  collected_at: '2026-10-01T00:00:00Z',
  items: [
    { id: 'a1', title: '단편영화 주연', category: 'short_film', source: 'x', source_name: '필름메이커스', apply_end: kstDaysFromNow(3), source_url: 'https://x' },
    { id: 'a2', title: '광고 모델', category: 'commercial', source: 'y', source_name: '오디션원', apply_end: kstDaysFromNow(0), source_url: 'https://y' },
    { id: 'a3', title: '지난 공고', category: 'drama', source: 'z', source_name: '방송사', apply_end: kstDaysFromNow(-2), source_url: 'https://z' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  endTutorial();
  mockAuth.user = { id: 'u1' };
  mockAuth.consentEntry = { status: 'allowed' };
  mockAuth.profile = { me: null };
  listPracticeGroups.mockResolvedValue({ groups: [] });
  listReadingScripts.mockResolvedValue({ scripts: [] });
  (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [] });
  (api.listChallenges as jest.Mock).mockResolvedValue({ featured: null });
  (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [], next_cursor: null });
  getPracticeNote.mockResolvedValue({ next_take: null, report: null });
  (api.admissions as jest.Mock).mockResolvedValue(admissionsPayload);
  (api.auditions as jest.Mock).mockResolvedValue(auditionsPayload);
  (hasSeenTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
  (rememberPracticeDays as jest.Mock).mockImplementation(async (records: { created_at: string }[]) => records);
  (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
});

describe('첫 사용자', () => {
  test('기록·대본·연습한 날이 없으면 액티 말풍선과 「뭐부터 해 볼까요?」 선택 카드 둘(코칭·리딩)을 보이고, 하나 골라 「다음」을 눌러야 그 탭에 간다', async () => {
    await render(<HomeScreen />);

    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
    expect(screen.getByText('하나를 누르면 자세히 알려 드려요')).toBeOnTheScreen();
    expect(screen.getByText('영상을 보여 주면 코치가 질문하며 고칠 점 하나를 같이 찾아요.')).toBeOnTheScreen();
    expect(screen.getByText('상대역 대사를 읽어 줘서 혼자서도 내 대사를 맞춰 봐요.')).toBeOnTheScreen();
    expect(screen.queryByText('이번 주 대사를 연기해요')).not.toBeOnTheScreen();
    await waitFor(() => expect(writeLastSeenStreak).toHaveBeenCalledWith(0));

    // 기본 선택이 없고, 고르기 전엔 「다음」이 막혀 있다.
    expect(screen.queryByRole('radio', { selected: true })).not.toBeOnTheScreen();
    const blocked = screen.getByRole('button', { name: '다음' });
    expect(blocked).toBeDisabled();
    await fireEvent.press(blocked);
    expect(mockRouter.push).not.toHaveBeenCalled();

    // 누르면 바로 가지 않고 골라 둔다.
    await fireEvent.press(screen.getByRole('radio', { name: '대본 리딩을 받아볼래요?' }));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '대본 리딩을 받아볼래요?', selected: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/reading');
  });

  test('선택지는 코칭·리딩 둘뿐이고(챌린지는 첫 연습 뒤), 코칭을 골라 「다음」을 누르면 코칭 탭으로 간다(SOMA-827)', async () => {
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: '챌린지에 참여해 볼래요?' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: '연기 코칭을 받아볼래요?' }));
    expect(screen.getAllByRole('radio', { selected: true })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/coaching');
  });

  test('대본만 넣고 끝까지 안 읽은 사람은 아직 첫 사용자다 — 선택지를 본다(SOMA-827)', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<HomeScreen />);

    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
    expect(screen.queryByText('갈매기 2막')).not.toBeOnTheScreen();
  });

  test('노트 전에 나간 코칭 묶음만 있는 사람도 아직 첫 사용자다(SOMA-827)', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [group({ title: '나간 장면', practices: [round('p1', '2026-08-15T03:00:00Z', false)] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
  });

  test('한 번도 안 읽은 대본은 「하던 대본」이 아니라 새 대본 카드다(연습 1회를 한 사람)', async () => {
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e-old', created_at: isoDaysAgo(20) }], next_cursor: null });
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<HomeScreen />);

    expect(await screen.findByText('갈매기 2막')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    // 한 번도 안 읽은 대본은 「하던 대본」이 아니다(10/22 피드백).
    expect(screen.getByText('리딩 · 새 대본')).toBeOnTheScreen();
    expect(screen.queryByText('이어 읽기')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '리딩 시작하기' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith('/reading'));
  });

  test('묶음을 못 받으면 첫 사용자로 보지 않는다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);
    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([]);
  });
});

describe('오늘 할 것 · 코칭 숙제', () => {
  test('지난 노트의 다음에 해 볼 것을 제목으로 쓰고, 액티 관찰(노트 제목)은 쓰지 않는다', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [
        group({
          root_id: 'r1',
          title: null,
          situation: '이별 통보 장면',
          ordinal_count: 2,
          practices: [round('p1', '2026-08-15T03:00:00Z', true)],
        }),
      ],
    });
    getPracticeNote.mockResolvedValue({ next_take: '「우리 그만하자」 뒤에 한 박자 바라보기', report: null });
    await render(<HomeScreen />);

    // pen P1.1 — 제목은 작은따옴표(‘ ’)로 감싼다.
    expect(await screen.findByText('‘「우리 그만하자」 뒤에 한 박자 바라보기’')).toBeOnTheScreen();
    expect(getPracticeNote).toHaveBeenCalledWith('p1');
    expect(screen.getByText('이별 통보 장면 · 3번째 테이크')).toBeOnTheScreen();
    expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '지금 찍기' }));
    expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'r1', practiceId: 'p1' });
    expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
  });

  test('다음에 해 볼 것이 없으면 그 칸 없이 장면 제목만 두고, 대화 중이면 그 대화로 돌아간다', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [
        group({
          root_id: 'r1',
          title: '카페 장면',
          in_progress_practice_id: 'open-1',
          practices: [round('p1', '2026-08-15T03:00:00Z', true)],
        }),
      ],
    });
    getPracticeNote.mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);

    expect(await screen.findByText('2번째 테이크')).toBeOnTheScreen();
    expect(screen.getAllByText('카페 장면').length).toBeGreaterThan(0);
    expect(screen.queryByText(/코치가 본 것/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '대화 이어 가기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } });
  });

  test('노트 없이 나간 묶음(1턴만 하고 나감)은 숙제가 아니다 — 연습 시작 카드를 보인다', async () => {
    // 첫 사용자가 아니게 예전에 올린 참여작 하나(연습 1회)를 둔다 — 2주 밖이라 주 기능은 바뀌지 않는다.
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e-old', created_at: isoDaysAgo(20) }], next_cursor: null });
    listPracticeGroups.mockResolvedValue({
      groups: [group({ title: '나간 장면', practices: [round('p1', '2026-08-15T03:00:00Z', false)] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('찍어 둔 연기로 코칭 받기')).toBeOnTheScreen();
    expect(getPracticeNote).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '코칭 시작하기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/coaching');
  });

  test('코칭과 리딩이 둘 다 있으면 나머지 하나는 하던 거 한 줄로 둔다', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [group({ title: '카페 장면', last_practiced_at: '2026-08-01T00:00:00Z', practices: [round('p1', '2026-08-01T00:00:00Z', true)] })],
    });
    listReadingScripts.mockResolvedValue({
      scripts: [script({ title: '햄릿', status: 'reading', last_practiced_at: '2026-08-20T00:00:00Z' })],
    });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'in_progress', progress: { total: 42, done: 18 } }] });
    getPracticeNote.mockResolvedValue({ next_take: '시선 거두기', report: null });
    await render(<HomeScreen />);

    // 메인은 이어 읽기 카드(18/42줄 · 남은 시간 한 줄, pen P1.15), 코칭 숙제는 「이것도 해 볼래요?」 줄이다.
    expect(await screen.findByText(/^18\/42줄 · 남은 시간 약 \d+분$/)).toBeOnTheScreen();
    expect(screen.getByText('이것도 해 볼까요?')).toBeOnTheScreen();
    expect(await screen.findByText('시선 거두기')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('코칭 숙제'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/upload');
  });
});

describe('연속 연습', () => {
  test('오늘 처음 연습했으면 한 번 축하하고, 계속하기를 누르면 닫는다', async () => {
    listPracticeGroups.mockResolvedValue({
      // 노트가 생긴 오늘 회차 하나(시각 없는 회차는 빼고)가 연습 1회다(SOMA-773).
      groups: [group({ practices: [round('p-today', isoDaysAgo(0), true), round('p-blank', '', true)] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 찍으면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([{ created_at: expect.any(String) }]);
    expect(writeLastSeenStreak).toHaveBeenLastCalledWith(1);
    expect(posterProps().blocked).toBe(true);

    await fireEvent.press(screen.getByText('계속하기'));
    expect(screen.queryByText('일 연속 연습!')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(false);
  });

  test('마지막으로 본 연속일을 읽는 사이 화면을 떠나면 아무것도 적지 않는다', async () => {
    let resolveSeen: (v: number) => void = () => undefined;
    (readLastSeenStreak as jest.Mock).mockReturnValue(new Promise((r) => (resolveSeen = r)));
    const view = await render(<HomeScreen />);
    await view.unmount();
    await act(async () => resolveSeen(0));
    expect(writeLastSeenStreak).not.toHaveBeenCalled();
  });

  test('이미 본 연속일이면 다시 축하하지 않는다', async () => {
    (readLastSeenStreak as jest.Mock).mockResolvedValue(1);
    listPracticeGroups.mockResolvedValue({
      groups: [group({ practices: [{ created_at: isoDaysAgo(0), note: { id: 'n' } }] as unknown as PracticeGroup['practices'] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    await waitFor(() => expect(readLastSeenStreak).toHaveBeenCalled());
    expect(screen.queryByText('일 연속 연습!')).not.toBeOnTheScreen();
  });

  test('기록을 못 받아도 기기에 쌓인 연습일로 연속일을 센다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    (rememberPracticeDays as jest.Mock).mockResolvedValue([{ created_at: isoDaysAgo(0) }, { created_at: isoDaysAgo(1) }]);
    (readLastSeenStreak as jest.Mock).mockResolvedValue(1);
    await render(<HomeScreen />);

    expect(await screen.findByLabelText('2일 연속 연습 축하')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([]);
    expect(writeLastSeenStreak).toHaveBeenLastCalledWith(2);
  });

  test('화면을 떠난 뒤 온 응답은 버린다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    let reject: (e: unknown) => void = () => undefined;
    listPracticeGroups.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = await render(<HomeScreen />);
    await first.unmount();
    await act(async () => resolve({ groups: [group({ title: '늦은 응답' })] }));
    expect(rememberPracticeDays).not.toHaveBeenCalled();

    listPracticeGroups.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const second = await render(<HomeScreen />);
    await second.unmount();
    await act(async () => reject(new Error('down')));
    expect(rememberPracticeDays).not.toHaveBeenCalled();
  });

  test('연습일을 합치는 사이 화면을 떠나면 연속일을 바꾸지 않는다', async () => {
    let resolveDays: (v: unknown) => void = () => undefined;
    let resolveFailedDays: (v: unknown) => void = () => undefined;
    listPracticeGroups.mockResolvedValueOnce({ groups: [] });
    (rememberPracticeDays as jest.Mock).mockReturnValueOnce(new Promise((r) => (resolveDays = r)));
    const first = await render(<HomeScreen />);
    await waitFor(() => expect(rememberPracticeDays).toHaveBeenCalledTimes(1));
    await first.unmount();
    await act(async () => resolveDays([{ created_at: isoDaysAgo(0) }]));
    expect(readLastSeenStreak).toHaveBeenCalledTimes(1);

    listPracticeGroups.mockRejectedValueOnce(new Error('down'));
    (rememberPracticeDays as jest.Mock).mockReturnValueOnce(new Promise((r) => (resolveFailedDays = r)));
    const second = await render(<HomeScreen />);
    await waitFor(() => expect(rememberPracticeDays).toHaveBeenCalledTimes(2));
    await second.unmount();
    await act(async () => resolveFailedDays([{ created_at: isoDaysAgo(0) }]));
    expect(writeLastSeenStreak).not.toHaveBeenCalled();
  });
});

describe('홈 카드와 「이것도 해 볼래요?」 줄', () => {
  const scriptRead = (title: string) =>
    script({ title, status: 'reading', last_practiced_at: isoDaysAgo(1) });
  const coachingGroup = (at: string) =>
    group({ title: '카페 장면', last_practiced_at: at, practices: [round('p1', at, true)] });
  const openChallenge = {
    id: 'c1',
    line: '잘 지내, 진짜로.',
    work: '헤어질 결심',
    ends_at: new Date(Date.now() + 3 * DAY).toISOString(),
    entry_count: 12,
  };

  test('오디션 마감 임박 구역은 가까운 마감 두 줄을 D-day와 함께 보이고, 지난 공고는 빼며, 누르면 오디션 모아보기로 간다', async () => {
    practiced();
    await render(<HomeScreen />);
    expect(await screen.findByText('오디션 마감 임박')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText('광고 모델')).toBeOnTheScreen());
    expect(screen.getByText('D-DAY')).toBeOnTheScreen();
    expect(screen.getByText('단편영화 주연')).toBeOnTheScreen();
    expect(screen.getByText('D-3')).toBeOnTheScreen();
    expect(screen.queryByText('지난 공고')).not.toBeOnTheScreen();
    // 입시생이 아니면 연기 입시 구역은 없다.
    expect(screen.queryByText('연기 입시')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('광고 모델'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/auditions');
  });

  test('만 19세 이하 입시생은 연기 입시 구역만 보고, 누르면 입시 일정으로 간다', async () => {
    practiced();
    mockAuth.profile = { me: { profile: { experience: 'exam_prep', birth_date: `${new Date().getFullYear() - 18}-01-01` } } };
    await render(<HomeScreen />);
    expect(await screen.findByText('연기 입시')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText('한국예술종합학교')).toBeOnTheScreen());
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('한국예술종합학교'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/admissions');
  });

  test('공고를 못 받으면 마감 구역은 그리지 않고 나머지 홈은 그대로다(pen P1.3)', async () => {
    practiced();
    (api.auditions as jest.Mock).mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);
    expect(await screen.findByText('이것도 해 볼까요?')).toBeOnTheScreen();
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
  });

  test('코칭이 메인이면 아래 줄은 리딩(멈춘 줄)·이번 주 챌린지·공고, 홈은 연속 일수와 요일 점을 보인다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(2))] });
    listReadingScripts.mockResolvedValue({ scripts: [scriptRead('옥상, 밤')] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'in_progress', progress: { total: 10, done: 3 } }] });
    (api.listChallenges as jest.Mock).mockResolvedValue({ featured: openChallenge });
    getPracticeNote.mockResolvedValue({ next_take: '시선 거두기', report: null });
    await render(<HomeScreen />);

    expect(await screen.findByText('추천 연습')).toBeOnTheScreen();
    expect(screen.getByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    // pen P1.1 — 리딩 줄 제목은 「대사 이어 읽기」, 아래는 멈춘 줄. 챌린지 줄은 ‘대사’ · D-day.
    expect(await screen.findByText('대사 이어 읽기')).toBeOnTheScreen();
    expect(await screen.findByText('3/10줄에서 멈췄어요')).toBeOnTheScreen();
    expect(await screen.findByText('‘잘 지내, 진짜로.’ · D-3')).toBeOnTheScreen();
    expect(screen.getByText('이번 주 챌린지')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('이번 주 챌린지'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-detail', params: { id: 'c1' } });
  });

  test('리딩이 메인이면 맨 위 인사는 이어 읽기를 권하고, 아래 줄은 코칭·챌린지·공고다', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [scriptRead('옥상, 밤')] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'in_progress', progress: { total: 10, done: 3 } }, { status: 'completed', started_at: isoDaysAgo(2), elapsed_seconds: 0 }] });
    (api.listChallenges as jest.Mock).mockResolvedValue({ featured: openChallenge });
    await render(<HomeScreen />);

    // 하루 전에 읽었으니 「어제」.
    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(await screen.findByText(/^3\/10줄 · 남은 시간 약 \d+분$/)).toBeOnTheScreen();
    // 진행 막대는 없다(pen P1.15).
    expect(screen.getByText('읽은 장면 찍어서 코칭')).toBeOnTheScreen();
    expect(screen.getByText('이번 주 챌린지')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '이어 읽기' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith('/reading'));
    await fireEvent.press(screen.getByText('읽은 장면 찍어서 코칭'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/coaching');
  });

  test('주로 한 기능이 챌린지면 열린 챌린지가 메인 카드가 되고, 첫 줄은 다른 배우 영상 보기다', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [scriptRead('옥상, 밤')] });
    (api.listChallenges as jest.Mock).mockResolvedValue({ featured: openChallenge });
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({
      entries: [{ id: 'e1', created_at: isoDaysAgo(1) }, { id: 'e2', created_at: isoDaysAgo(2) }],
      next_cursor: null,
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.getByText('이번 주 챌린지 · D-3')).toBeOnTheScreen();
    expect(screen.getByText('“잘 지내, 진짜로.”')).toBeOnTheScreen();
    expect(screen.getByText('같은 대사, 다른 연기 · 참여 12명')).toBeOnTheScreen();
    expect(screen.getByText('다른 배우 영상 보기')).toBeOnTheScreen();
    // pen P1.16 — 참여작 수가 있으면 「이번 주 참여작 N개」.
    expect(screen.getByText('이번 주 참여작 12개')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '찍으러 가기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-detail', params: { id: 'c1' } });
    await fireEvent.press(screen.getByText('다른 배우 영상 보기'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/challenges');
  });

  test('리딩 메인 카드 제목은 대본 제목 · 내 배역이다(pen P1.15 「옥상, 밤 · 태오」)', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [{ ...scriptRead('옥상, 밤'), my_character_names: ['태오'] }] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'in_progress', progress: { total: 10, done: 3 } }, { status: 'completed', started_at: isoDaysAgo(2), elapsed_seconds: 0 }] });
    await render(<HomeScreen />);

    expect(await screen.findByText('옥상, 밤 · 태오')).toBeOnTheScreen();
  });

  test('최근 2주에 리딩을 더 많이 했으면 더 최근에 한 코칭이 있어도 리딩이 메인이다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    listReadingScripts.mockResolvedValue({ scripts: [scriptRead('햄릿')] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({
      sessions: [
        { status: 'completed', started_at: isoDaysAgo(1) },
        { status: 'completed', started_at: isoDaysAgo(2), elapsed_seconds: 0 },
        { status: 'completed', started_at: isoDaysAgo(3) },
      ],
    });
    await render(<HomeScreen />);
    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!', {}, { timeout: 2000 })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '이어 읽기' })).toBeOnTheScreen();
  });

  test('연속 일수와 이번 주 요일 점 일곱 개를 보이고, 연습한 날은 체크로 채운다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e1', created_at: isoDaysAgo(0) }], next_cursor: null });
    await render(<HomeScreen />);

    expect(await screen.findByText('1일째!')).toBeOnTheScreen();
    expect(screen.getByText('오늘')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^home-week-/)).toHaveLength(7);
    expect(screen.getAllByTestId('home-week-done').length).toBeGreaterThanOrEqual(1);
  });
});

describe('첫 안내', () => {
  const withHost = (
    <>
      <HomeScreen />
      <SpotlightHost />
    </>
  );

  test('처음 연 사람은 본 것으로 적고 공지 포스터에 막 온보딩을 마쳤다고 알린다', async () => {
    (hasSeenTutorial as jest.Mock).mockResolvedValue(false);
    await render(<HomeScreen />);

    await waitFor(() => expect(markTutorialSeen).toHaveBeenCalled());
    expect(posterProps().onboardingJustFinished).toBe(true);
  });

  test('첫 연습을 끝낸 홈에서 안내를 띄우고, 안내를 본 그 방문에는 공지 포스터를 미룬다', async () => {
    practiced();
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    expect(hasSeenSpotlight).toHaveBeenCalledWith('home');
    await fireEvent.press(await screen.findByText('건너뛰기', {}, { timeout: 2000 }));
    await waitFor(() => expect(markSpotlightSeen).toHaveBeenCalledWith('home'));
    // 안내가 끝나자마자 다른 팝업(AI 목소리 홍보 등)이 이어 뜨지 않는다.
    expect(posterProps().blocked).toBe(true);

    // 다음 방문(다시 포커스)에는 막지 않는다.
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
    await act(async () => void mockFocusEffect());
    await waitFor(() => expect(posterProps().blocked).toBe(false));
  });

  test('첫 사용자 홈(뭐부터 해 볼까요?)에서는 홈 안내를 띄우지 않는다', async () => {
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);
    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
    await act(async () => new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByText('건너뛰기')).not.toBeOnTheScreen();
  });

  test('튜토리얼 중에 홈으로 돌아오면 튜토리얼을 끝낸다', async () => {
    startTutorial('own');
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    expect(currentTutorial()).toBeNull();
  });

  test('재동의 팝업이 떠 있는 동안은 첫 안내를 미루고, 닫힌 뒤에 띄운다', async () => {
    practiced();
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    mockAuth.consentEntry = { status: 'required' };
    const view = await render(withHost);
    await screen.findByText('이것도 해 볼까요?');
    await act(async () => new Promise((r) => setTimeout(r, 900)));

    expect(screen.queryByText('건너뛰기')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(true);

    mockAuth.consentEntry = { status: 'allowed' };
    await view.rerender(
      <>
        <HomeScreen />
        <SpotlightHost />
      </>,
    );
    expect(await screen.findByText('건너뛰기', {}, { timeout: 2000 })).toBeOnTheScreen();
  });

  test('로그인하지 않았으면 공지 포스터에 그렇게 알린다', async () => {
    mockAuth.user = null;
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    expect(posterProps().loggedIn).toBe(false);
  });
});

describe('안드로이드 뒤로가기', () => {
  const os = Platform.OS;
  let handler: (() => boolean) | null = null;
  const remove = jest.fn();
  beforeEach(() => {
    Platform.OS = 'android';
    handler = null;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event: unknown, h: unknown) => {
      handler = h as () => boolean;
      return { remove };
    });
    jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
  });
  afterEach(() => {
    Platform.OS = os;
    jest.restoreAllMocks();
  });

  test('홈에서 한 번 누르면 안내 토스트만 띄우고, 2초 안에 한 번 더 누르면 앱을 닫는다', async () => {
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');

    let consumed = false;
    await act(async () => {
      consumed = handler?.() ?? false;
    });
    expect(consumed).toBe(true);
    expect(toast).toHaveBeenCalledWith('한 번 더 누르면 앱이 닫혀요', ToastAndroid.SHORT);
    expect(BackHandler.exitApp).not.toHaveBeenCalled();

    await act(async () => void handler?.());
    expect(BackHandler.exitApp).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  test('첫 누름 뒤 2초가 지나면 다시 토스트부터 띄운다', async () => {
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    await act(async () => void handler?.());
    now.mockReturnValue(1_003_000);
    await act(async () => void handler?.());
    expect(toast).toHaveBeenCalledTimes(2);
    expect(BackHandler.exitApp).not.toHaveBeenCalled();
  });

  test('홈을 떠나면 뒤로가기 가로채기를 푼다', async () => {
    const view = await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});

test('다시 포커스되면 기록을 다시 읽는다', async () => {
  await render(<HomeScreen />);
  await screen.findByText('뭐부터 해 볼까요?');
  // 다른 화면에서 대본을 끝까지 읽고 돌아왔다 — 다시 읽으면 기본 홈으로 바뀐다.
  listReadingScripts.mockResolvedValue({ scripts: [script({ title: '다시 읽은 대본', status: 'completed' })] });
  await act(async () => void mockFocusEffect());
  await waitFor(() => expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen());
  expect(listReadingScripts.mock.calls.length).toBeGreaterThanOrEqual(2);
});
