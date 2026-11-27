import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Platform, ToastAndroid } from 'react-native';

import { AnnouncementPoster } from '@/components/announcement-poster';
import { TabLaunchOverlays } from '@/components/tab-launch-overlays';
import { WeekPracticeCard } from '@/components/week-practice-card';
import { PracticeRecordsProvider, usePracticeRecords } from '@/hooks/use-practice-records';
import { api } from '@/lib/api';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { rememberPracticeDays, sessionPracticeDays } from '@/lib/practice-days';
import { getFirstTimeState, setFirstTimeState } from '@/lib/practice/first-time';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';
import type { ScriptCard } from '@/lib/reading/types';
import { readLastSeenStreak, writeLastSeenStreak } from '@/lib/streak-celebration';

/**
 * 예전 홈(app/(tabs)/index)이 하던 일 — 기록 읽기·첫 사용자 판정(hooks/use-practice-records)과 그 위에 뜨는 것들
 * (components/tab-launch-overlays) — 을 탭 레이아웃에서 시험한다(SOMA-1120). 이번 주 연습 카드는 프로필에 그린다.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
// 탭 묶음의 useFocusEffect 전부 — 다시 포커스는 모두 다시 부른다.
const mockFocusEffects = new Set<() => void | (() => void)>();
const mockFocusEffect = () => mockFocusEffects.forEach((effect) => effect());
// 탭 기록 — 1이면 더 돌아갈 탭이 없다.
const mockTabHistory = { length: 1 };
const mockNavigation = {
  getState: () => ({ index: 0, routes: [{ name: '(tabs)', state: { history: Array.from({ length: mockTabHistory.length }) } }] }),
};
const mockAuth = {
  user: { id: 'u1' } as { id: string } | null,
  consentEntry: { status: 'allowed' },
  profile: { me: { id: 'u1' } as { id: string; profile?: { name?: string } }, status: 'complete' as string },
};

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavigation,
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
    listMyChallengeEntries: jest.fn(),
    practiceDays: jest.fn(),
  },
}));
jest.mock('@/lib/home-snapshot', () => ({ readHomeSnapshot: jest.fn(async () => null), writeHomeSnapshot: jest.fn(async () => undefined) }));
jest.mock('@/lib/guide-state', () => ({
  hasSeenSpotlight: jest.fn(),
  hasSeenTutorial: jest.fn(),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
}));
// 코칭 끝 화면이 적는 이번 실행의 연습한 날(SOMA-1075). 시험이 값을 바꾸고 mockSessionDaysChanged 로 알린다.
const mockNoSessionDays: { created_at: string }[] = [];
const mockSessionListeners = new Set<() => void>();
const mockSessionDaysChanged = () => mockSessionListeners.forEach((listener) => listener());
jest.mock('@/lib/practice-days', () => ({
  rememberPracticeDays: jest.fn(),
  serverPracticeDayRecords: jest.requireActual('@/lib/practice-days').serverPracticeDayRecords,
  sessionPracticeDays: jest.fn(() => mockNoSessionDays),
  subscribeSessionPracticeDays: (listener: () => void) => {
    mockSessionListeners.add(listener);
    return () => mockSessionListeners.delete(listener);
  },
}));
jest.mock('@/lib/practice/first-use-graduation', () => ({
  hasGraduatedFirstUse: jest.fn(async () => false),
  markFirstUseGraduated: jest.fn(async () => undefined),
  currentFirstUseOwner: jest.fn(() => 'u1'),
  graduatedInMemory: jest.fn(() => false),
}));
jest.mock('@/lib/streak-celebration', () => ({
  ...jest.requireActual('@/lib/streak-celebration'),
  readLastSeenStreak: jest.fn(),
  writeLastSeenStreak: jest.fn(async () => undefined),
}));
jest.mock('@/components/announcement-poster', () => ({ AnnouncementPoster: jest.fn(() => null) }));

const listPracticeGroups = api.listPracticeGroups as jest.Mock;
const listReadingScripts = api.listReadingScripts as jest.Mock;
const posterProps = () => (AnnouncementPoster as unknown as jest.Mock).mock.calls.at(-1)[0];
const graduation = () => jest.requireMock('@/lib/practice/first-use-graduation');

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const kstDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY + 9 * 3_600_000).toISOString().slice(0, 10);

const round = (id: string, at: string, noted: boolean): PracticeRound =>
  ({
    id,
    ordinal: 1,
    created_at: at,
    stage: 'done',
    message_count: 4,
    note: noted ? { id: `note-${id}`, title: '액티가 본 것', kind: 'action' } : null,
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
const coachingGroup = (at: string) => group({ last_practiced_at: at, practices: [round('p1', at, true)] });

/** 탭 레이아웃과 같은 모양 — 공급자 안에 프로필의 이번 주 연습 카드와 탭 위 덮개. */
function WeekFromRecords() {
  const records = usePracticeRecords();
  return (
    <WeekPracticeCard days={records.weekDays} practicedDays={records.weekPracticedDays} totalDays={records.totalDays} loading={!records.activityLoaded} />
  );
}
const Tabs = () => (
  <PracticeRecordsProvider>
    <WeekFromRecords />
    <TabLaunchOverlays />
  </PracticeRecordsProvider>
);
// 오버레이 준비(재동의 팝업이 닫힌 뒤 800ms)를 기다린다.
const settle = () => act(async () => new Promise((r) => setTimeout(r, 850)));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: 'u1' };
  mockAuth.consentEntry = { status: 'allowed' };
  mockAuth.profile = { me: { id: 'u1' }, status: 'complete' };
  mockTabHistory.length = 1;
  setFirstTimeState('unknown');
  graduation().hasGraduatedFirstUse.mockImplementation(async () => false);
  graduation().graduatedInMemory.mockImplementation(() => false);
  listPracticeGroups.mockResolvedValue({ groups: [] });
  listReadingScripts.mockResolvedValue({ scripts: [] });
  (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [] });
  (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [], next_cursor: null });
  (api.practiceDays as jest.Mock).mockResolvedValue({ days: [] });
  (hasSeenTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
  (rememberPracticeDays as jest.Mock).mockImplementation(async (records: { created_at: string }[]) => records);
  (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
  (sessionPracticeDays as jest.Mock).mockImplementation(() => mockNoSessionDays);
});

describe('첫 사용자 안내(뭐부터 해 볼까요?) — 처음 한 번', () => {
  test('끝낸 연습이 없으면 탭 위에 선택 카드 둘(코칭·리딩)을 덮고, 하나 골라 「다음」을 누르면 본 것으로 적고 그 탭으로 간다', async () => {
    await render(<Tabs />);
    await settle();

    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
    expect(getFirstTimeState()).toBe('first');
    expect(hasSeenSpotlight).toHaveBeenCalledWith('firstUse');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    // 첫 항목(코칭)을 미리 골라 둔다(10/23). 누르기 전엔 넘어가지 않는다.
    expect(screen.getByRole('radio', { name: '연기 코칭을 받아볼래요?', selected: true })).toBeOnTheScreen();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    // 안내가 떠 있는 동안 공지 포스터는 미룬다.
    expect(posterProps().blocked).toBe(true);

    await fireEvent.press(screen.getByRole('radio', { name: '대본 리딩을 받아볼래요?' }));
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith('/reading');
    expect(markSpotlightSeen).toHaveBeenCalledWith('firstUse');
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(false);
  });

  test('코칭을 고른 채 「다음」을 누르면 코칭 탭으로 간다(SOMA-827)', async () => {
    await render(<Tabs />);
    await settle();
    await screen.findByText('뭐부터 해 볼까요?');
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.navigate).toHaveBeenLastCalledWith('/coaching');
  });

  test('한 번 본 계정이면 아직 첫 사용자여도 다시 띄우지 않는다', async () => {
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(getFirstTimeState()).toBe('first'));
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
  });

  test('이 기기에서 리딩·코칭을 끝까지 해 본 계정은 서버 기록이 비어도 첫 사용자가 아니다(SOMA-827)', async () => {
    graduation().hasGraduatedFirstUse.mockImplementation(async (id: string) => id === 'u1');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(getFirstTimeState()).toBe('practiced'));
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
  });

  test('기록으로 첫 사용자를 벗어나면 졸업 표시를 남긴다(11/2)', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막', status: 'completed' })] });
    await render(<Tabs />);
    await waitFor(() => expect(graduation().markFirstUseGraduated).toHaveBeenCalledWith('u1'));
    expect(getFirstTimeState()).toBe('practiced');
  });

  test('14일보다 전에 끝까지 읽은 대본만 있는 사람도 첫 사용자가 아니다(11/2)', async () => {
    const old = new Date(Date.now() - 30 * DAY).toISOString();
    listReadingScripts.mockResolvedValue({ scripts: [script({ status: 'reading', last_practiced_at: old })] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'completed', started_at: old, progress: { total: 10, done: 10 } }] });
    await render(<Tabs />);
    await waitFor(() => expect(graduation().markFirstUseGraduated).toHaveBeenCalledWith('u1'));
    await settle();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
  });

  test('대본 목록이나 묶음을 못 받으면 첫 사용자로 보지 않는다', async () => {
    listReadingScripts.mockRejectedValue(new Error('network'));
    const view = await render(<Tabs />);
    await settle();
    await waitFor(() => expect(rememberPracticeDays).toHaveBeenCalled());
    expect(getFirstTimeState()).toBe('unknown');
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    await view.unmount();

    listReadingScripts.mockResolvedValue({ scripts: [] });
    listPracticeGroups.mockRejectedValue(new Error('down'));
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(rememberPracticeDays).toHaveBeenLastCalledWith([], 'u1'));
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
  });

  test('대본만 넣고 끝까지 안 읽은 사람, 노트 전에 나간 코칭 묶음만 있는 사람은 아직 첫 사용자다(SOMA-827)', async () => {
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    listPracticeGroups.mockResolvedValue({ groups: [group({ practices: [round('p1', '2026-08-15T03:00:00Z', false)] })] });
    await render(<Tabs />);
    await settle();
    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
  });

  test('다시 포커스되면 기록을 다시 읽고, 끝낸 연습이 보이면 안내를 닫는다', async () => {
    await render(<Tabs />);
    await settle();
    await screen.findByText('뭐부터 해 볼까요?');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '다시 읽은 대본', status: 'completed' })] });
    await act(async () => void mockFocusEffect());
    await waitFor(() => expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen());
    expect(listReadingScripts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('처음 연 사람은 본 것으로 적고 공지 포스터에 막 온보딩을 마쳤다고 알린다', async () => {
    (hasSeenTutorial as jest.Mock).mockResolvedValue(false);
    await render(<Tabs />);
    await waitFor(() => expect(markTutorialSeen).toHaveBeenCalled());
    expect(posterProps().onboardingJustFinished).toBe(true);
  });

  test('재동의 팝업이 떠 있는 동안은 안내를 띄우지 않는다', async () => {
    mockAuth.consentEntry = { status: 'decision_required' };
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(getFirstTimeState()).toBe('first'));
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(true);
  });
});

describe('연속 연습 축하', () => {
  test('오늘 처음 연습했으면 한 번 축하하고, 계속하기를 누르면 닫는다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [group({ practices: [round('p-today', isoDaysAgo(0), true), round('p-blank', '', true)] })] });
    await render(<Tabs />);
    await settle();

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([{ created_at: expect.any(String) }], 'u1');
    expect(writeLastSeenStreak).toHaveBeenLastCalledWith(1);
    expect(posterProps().blocked).toBe(true);

    await fireEvent.press(screen.getByText('계속하기'));
    expect(screen.queryByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(false);
  });

  test('이미 본 연속일이면 다시 축하하지 않는다', async () => {
    (readLastSeenStreak as jest.Mock).mockResolvedValue(1);
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(readLastSeenStreak).toHaveBeenCalled());
    expect(screen.queryByLabelText('1일 연속 연습 축하')).not.toBeOnTheScreen();
  });

  test('오늘 연습이 없으면 어제까지의 연속일로 축하하지 않는다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(1))] });
    await render(<Tabs />);
    await waitFor(() => expect(writeLastSeenStreak).toHaveBeenLastCalledWith(1));
    expect(screen.queryByLabelText('1일 연속 연습 축하')).not.toBeOnTheScreen();
  });

  test('기록을 못 받아도 기기에 쌓인 연습일로 연속일을 센다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    (rememberPracticeDays as jest.Mock).mockResolvedValue([{ created_at: isoDaysAgo(0) }, { created_at: isoDaysAgo(1) }]);
    (readLastSeenStreak as jest.Mock).mockResolvedValue(1);
    await render(<Tabs />);
    await settle();

    expect(await screen.findByLabelText('2일 연속 연습 축하')).toBeOnTheScreen();
    expect(writeLastSeenStreak).toHaveBeenLastCalledWith(2);
  });

  test('탭 묶음을 떠난 뒤 온 응답은 버린다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    listPracticeGroups.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const view = await render(<Tabs />);
    await view.unmount();
    await act(async () => resolve({ groups: [coachingGroup(isoDaysAgo(0))] }));
    expect(rememberPracticeDays).not.toHaveBeenCalled();
  });

  test('코칭 끝 화면이 적은 오늘 회차로 서버 기록을 다시 받기 전에 불꽃을 띄우고, 기기 저장소에는 넣지 않는다(SOMA-1075)', async () => {
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
    await render(<Tabs />);
    await settle();
    await waitFor(() => expect(getFirstTimeState()).toBe('first'));

    // useSyncExternalStore 는 같은 값을 돌려받아야 한다 — 배열을 한 번만 만든다.
    const today = [{ created_at: isoDaysAgo(0) }];
    (sessionPracticeDays as jest.Mock).mockImplementation((id: string) => (id === 'u1' ? today : mockNoSessionDays));
    await act(async () => mockSessionDaysChanged());
    graduation().graduatedInMemory.mockImplementation((id: string) => id === 'u1');
    await act(async () => jest.requireActual('@/lib/practice/first-use-graduation').markFirstUseGraduated('u1'));

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledTimes(1);
    expect(getFirstTimeState()).toBe('practiced');
  });
});

describe('이번 주 연습 기록', () => {
  test('이번 주·누적 일수와 요일 원 일곱 개를 보이고, 연습한 날은 그날 횟수를 보인다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e1', created_at: isoDaysAgo(0) }], next_cursor: null });
    await render(<Tabs />);

    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^home-week-/)).toHaveLength(7);
    // 오늘 코칭 1번 + 챌린지 1번 = 2번 — 원 안에 파랑이 차오른다.
    const done = screen.getAllByTestId('home-week-done');
    expect(done).toHaveLength(1);
    expect(done[0]).toHaveTextContent('2');
    expect(screen.getAllByTestId('week-fill')).toHaveLength(1);
    expect(screen.getByLabelText('오늘 연습 2번')).toBeOnTheScreen();
    expect(screen.getAllByLabelText(/연습 없음$/)).toHaveLength(6);
  });

  test('서버가 센 지난 연습일까지 누적 일수에 넣고, 연습일 목록을 못 받아도 그대로 연다(SOMA-1003)', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    (api.practiceDays as jest.Mock).mockResolvedValue({ days: [kstDay(40), kstDay(30), kstDay(0)] });
    const view = await render(<Tabs />);
    expect(await screen.findByText('이번 주 1일 · 누적 3일')).toBeOnTheScreen();
    await view.unmount();

    (api.practiceDays as jest.Mock).mockRejectedValue(new Error('down'));
    await render(<Tabs />);
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  test('받기 전에는 원 자리를 회색 뼈대로 둔다', async () => {
    listPracticeGroups.mockReturnValue(new Promise(() => undefined));
    await render(<Tabs />);
    expect(screen.getByText('이번 주 연습')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^home-week-(done|empty|today)$/)).toHaveLength(0);
  });

  // 11/2 폰 QA — 오프라인으로 켜면 동의 팝업 뒤에서 기록 읽기에 실패한 채 남았다. 게이트가 열리면 다시 읽는다.
  test('동의·프로필 게이트가 열리는 순간 기록을 다시 읽는다', async () => {
    mockAuth.consentEntry = { status: 'error' };
    mockAuth.profile.status = 'error';
    listPracticeGroups.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<Tabs />);
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(1));

    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    mockAuth.consentEntry = { status: 'allowed' };
    mockAuth.profile.status = 'complete';
    await view.rerender(<Tabs />);
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  test('게이트 전에 이 계정으로 다 받았으면 게이트가 열려도 다시 읽지 않는다(11/3)', async () => {
    mockAuth.consentEntry = { status: 'checking' };
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    const view = await render(<Tabs />);
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();

    mockAuth.consentEntry = { status: 'allowed' };
    await view.rerender(<Tabs />);
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(listPracticeGroups).toHaveBeenCalledTimes(1);
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

  test('더 돌아갈 탭이 없으면 한 번은 안내 토스트, 2초 안에 한 번 더 누르면 앱을 닫는다', async () => {
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    await render(<Tabs />);

    let consumed = false;
    await act(async () => {
      consumed = handler?.() ?? false;
    });
    expect(consumed).toBe(true);
    expect(toast).toHaveBeenCalledWith('한 번 더 누르면 앱이 닫혀요', ToastAndroid.SHORT);
    expect(BackHandler.exitApp).not.toHaveBeenCalled();

    await act(async () => void handler?.());
    expect(BackHandler.exitApp).toHaveBeenCalledTimes(1);
  });

  test('돌아갈 탭이 있으면 가로채지 않고 탭 기록대로 돌아가게 둔다', async () => {
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    mockTabHistory.length = 2;
    await render(<Tabs />);
    expect(handler?.()).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  test('탭 묶음을 떠나면 가로채기를 푼다', async () => {
    const view = await render(<Tabs />);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});
