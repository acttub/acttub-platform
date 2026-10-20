import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/index';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { SpotlightHost } from '@/components/spotlight-guide';
import { localDate } from '@/lib/admissions';
import { kstDate } from '@/lib/auditions';
import { api } from '@/lib/api';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import type { PracticeGroup } from '@/lib/practice/types';
import { readLastSeenStreak, writeLastSeenStreak } from '@/lib/streak-celebration';
import { currentTutorial, endTutorial, startTutorial } from '@/lib/tutorial';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockFocusEffect: () => void | (() => void) = () => undefined;
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
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/api', () => ({
  api: { listPracticeGroups: jest.fn(), admissions: jest.fn(), auditions: jest.fn() },
}));
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
const posterProps = () => (AnnouncementPoster as unknown as jest.Mock).mock.calls.at(-1)[0];

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const kstDaysFromNow = (n: number) => kstDate(new Date(Date.now() + n * DAY));
const localDaysFromNow = (n: number) => localDate(new Date(Date.now() + n * DAY));

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
  (api.admissions as jest.Mock).mockResolvedValue(admissionsPayload);
  (api.auditions as jest.Mock).mockResolvedValue(auditionsPayload);
  (hasSeenTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
  (rememberPracticeDays as jest.Mock).mockImplementation(async (records: { created_at: string }[]) => records);
  (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
});

test('기록이 없으면 빈 안내와 0일 연속을 보여 주고, 연습 시작은 준비 화면으로 간다', async () => {
  await render(<HomeScreen />);

  expect(await screen.findByText('아직 기록이 없어요.\n가운데 파란 버튼으로 첫 영상을 올려보세요.')).toBeOnTheScreen();
  expect(screen.getByText('연속 연습 0일')).toBeOnTheScreen();
  expect(screen.getByLabelText('월요일 0회')).toBeOnTheScreen();
  await waitFor(() => expect(writeLastSeenStreak).toHaveBeenCalledWith(0));
  expect(screen.queryByText('일 연속 연습!')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '연습 시작' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
  await fireEvent.press(screen.getAllByText('전체보기 ›')[0]);
  expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
});

test('최근 연습은 숨기지 않은 묶음 셋을 최근 순으로 보여 주고, 대화 중인 묶음은 그 대화로 간다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [
      group({ root_id: 'r1', title: '카페 장면', last_practiced_at: '2026-08-15T03:00:00Z', poster_url: 'https://cdn/p.jpg?sig=1' }),
      group({ root_id: 'r2', title: '옥상 고백', in_progress_practice_id: 'open-2', last_practiced_at: '2026-09-02T03:00:00Z' }),
      group({ root_id: 'r3', title: '숨긴 장면', hidden_at: '2026-09-03T00:00:00Z', last_practiced_at: '2026-09-04T03:00:00Z' }),
      group({ root_id: 'r4', title: '첫 오디션', last_practiced_at: '2026-07-01T03:00:00Z' }),
      group({ root_id: 'r5', title: '오래된 장면', last_practiced_at: '2026-06-01T03:00:00Z' }),
    ],
  });
  await render(<HomeScreen />);

  expect(await screen.findByText('옥상 고백')).toBeOnTheScreen();
  const titles = screen.getAllByText(/카페 장면|옥상 고백|첫 오디션|오래된 장면|숨긴 장면/).map((n) => n.props.children);
  expect(titles).toEqual(['옥상 고백', '카페 장면', '첫 오디션']);
  expect(screen.getByText('9월 2일')).toBeOnTheScreen();
  expect(screen.getAllByText('대화 중')).toHaveLength(1);

  await fireEvent.press(screen.getByText('옥상 고백'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/analyzing', params: { practiceId: 'open-2' } });
  await fireEvent.press(screen.getByText('카페 장면'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/practice-group', params: { rootId: 'r1' } });
});

test('날짜를 모르는 묶음은 날짜 칸을 비운다', async () => {
  listPracticeGroups.mockResolvedValue({ groups: [group({ title: '날짜 없음', last_practiced_at: null })] });
  await render(<HomeScreen />);
  expect(await screen.findByText('날짜 없음')).toBeOnTheScreen();
  expect(screen.queryByText(/월 \d+일/)).not.toBeOnTheScreen();
});

describe('연속 연습', () => {
  test('오늘 처음 연습했으면 한 번 축하하고, 계속하기를 누르면 닫는다', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [group({ practices: [{ created_at: isoDaysAgo(0) }, { created_at: '' }] as PracticeGroup['practices'] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 찍으면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([{ created_at: expect.any(String) }]);
    expect(screen.getByText('연속 연습 1일')).toBeOnTheScreen();
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
      groups: [group({ practices: [{ created_at: isoDaysAgo(0) }] as PracticeGroup['practices'] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('연속 연습 1일')).toBeOnTheScreen();
    expect(screen.queryByText('일 연속 연습!')).not.toBeOnTheScreen();
  });

  test('기록을 못 받아도 기기에 쌓인 연습일로 연속일을 센다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    (rememberPracticeDays as jest.Mock).mockResolvedValue([{ created_at: isoDaysAgo(1) }, { created_at: isoDaysAgo(2) }]);
    (readLastSeenStreak as jest.Mock).mockResolvedValue(2);
    await render(<HomeScreen />);

    expect(await screen.findByText('연속 연습 2일')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([]);
    expect(screen.getByText('아직 기록이 없어요.\n가운데 파란 버튼으로 첫 영상을 올려보세요.')).toBeOnTheScreen();
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

describe('마감 임박 카드', () => {
  test('입시생이 아니면 오디션만, 마감이 가까운 둘을 D-day와 함께 보여 준다', async () => {
    await render(<HomeScreen />);

    expect(await screen.findByText('오디션 마감 임박')).toBeOnTheScreen();
    expect(screen.queryByText('연기 입시')).not.toBeOnTheScreen();
    const titles = screen.getAllByText(/단편영화 주연|광고 모델|지난 공고/).map((n) => n.props.children);
    expect(titles).toEqual(['광고 모델', '단편영화 주연']);
    expect(screen.getByText('D-DAY')).toBeOnTheScreen();
    expect(screen.getByText('D-3')).toBeOnTheScreen();
    expect(screen.getByText('필름메이커스')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '오디션 공고 보기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/auditions');
    await fireEvent.press(screen.getAllByText('전체보기 ›')[1]);
    expect(mockRouter.push).toHaveBeenLastCalledWith('/auditions');
  });

  test('만 19세 이하 입시생은 입시 일정만 본다', async () => {
    mockAuth.profile = { me: { profile: { experience: 'exam_prep', birth_date: `${new Date().getFullYear() - 18}-01-01` } } };
    await render(<HomeScreen />);

    expect(await screen.findByText('연기 입시')).toBeOnTheScreen();
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
    expect(screen.getByText('한국예술종합학교')).toBeOnTheScreen();
    expect(screen.getByText('연기과')).toBeOnTheScreen();
    expect(screen.getByText('접수 마감')).toBeOnTheScreen();
    expect(screen.getByText('중앙대학교')).toBeOnTheScreen();
    expect(screen.getByText('D-5')).toBeOnTheScreen();
    expect(screen.getByText('접수 시작')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '연기 입시 정보 보기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/admissions');
    await fireEvent.press(screen.getAllByText('전체보기 ›')[1]);
    expect(mockRouter.push).toHaveBeenLastCalledWith('/admissions');
  });

  test('공고를 못 받으면 두 카드 모두 숨긴다', async () => {
    mockAuth.profile = { me: { profile: { experience: 'exam_prep', birth_date: null } } };
    (api.admissions as jest.Mock).mockRejectedValue(new Error('down'));
    (api.auditions as jest.Mock).mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);

    await waitFor(() => expect(api.auditions).toHaveBeenCalled());
    expect(screen.queryByText('연기 입시')).not.toBeOnTheScreen();
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
  });

  test('화면을 떠난 뒤 온 공고 응답은 버린다', async () => {
    let resolveAdmissions: (v: unknown) => void = () => undefined;
    let rejectAuditions: (e: unknown) => void = () => undefined;
    (api.admissions as jest.Mock).mockReturnValue(new Promise((r) => (resolveAdmissions = r)));
    (api.auditions as jest.Mock).mockReturnValue(new Promise((_, r) => (rejectAuditions = r)));
    const view = await render(<HomeScreen />);
    await view.unmount();
    await act(async () => {
      resolveAdmissions(admissionsPayload);
      rejectAuditions(new Error('down'));
    });
    expect(screen.queryByText('연기 입시')).not.toBeOnTheScreen();

    let rejectAdmissions: (e: unknown) => void = () => undefined;
    let resolveAuditions: (v: unknown) => void = () => undefined;
    (api.admissions as jest.Mock).mockReturnValue(new Promise((_, r) => (rejectAdmissions = r)));
    (api.auditions as jest.Mock).mockReturnValue(new Promise((r) => (resolveAuditions = r)));
    const again = await render(<HomeScreen />);
    await again.unmount();
    await act(async () => {
      rejectAdmissions(new Error('down'));
      resolveAuditions(auditionsPayload);
    });
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
  });
});

describe('첫 안내', () => {
  const withHost = (
    <>
      <HomeScreen />
      <SpotlightHost />
    </>
  );

  test('처음 연 사람에게 연습 한 바퀴를 권하고, 나중에를 고르면 본 것으로 적고 홈 안내를 띄운다', async () => {
    (hasSeenTutorial as jest.Mock).mockResolvedValue(false);
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    expect(await screen.findByText('연습 한 바퀴를 직접 돌아볼까요?')).toBeOnTheScreen();
    expect(posterProps().blocked).toBe(true);
    await fireEvent.press(screen.getByText('나중에 할게요'));

    expect(markTutorialSeen).toHaveBeenCalled();
    expect(hasSeenSpotlight).toHaveBeenCalledWith('home');
    expect(posterProps().onboardingJustFinished).toBe(true);
    await fireEvent.press(await screen.findByText('건너뛰기'));
    await waitFor(() => expect(markSpotlightSeen).toHaveBeenCalledWith('home'));
  });

  test.each([
    ['예시 영상으로 둘러보기', 'sample', { pathname: '/upload', params: { sample: '1' } }],
    ['내 영상으로 해 보기', 'own', '/upload'],
  ])('%s를 고르면 튜토리얼을 시작하고 준비 화면으로 간다', async (label, mode, target) => {
    (hasSeenTutorial as jest.Mock).mockResolvedValue(false);
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: label }));

    expect(currentTutorial()).toEqual({ mode, track: 'practice' });
    expect(mockRouter.push).toHaveBeenCalledWith(target);
  });

  test('튜토리얼 중에 홈으로 돌아오면 튜토리얼을 끝낸다', async () => {
    startTutorial('own');
    await render(<HomeScreen />);
    await screen.findByText('연속 연습 0일');
    expect(currentTutorial()).toBeNull();
  });

  test('재동의 팝업이 떠 있는 동안은 첫 안내를 미루고, 닫힌 뒤에 띄운다', async () => {
    (hasSeenTutorial as jest.Mock).mockResolvedValue(false);
    mockAuth.consentEntry = { status: 'required' };
    const view = await render(<HomeScreen />);
    await waitFor(() => expect(hasSeenTutorial).toHaveBeenCalled());

    expect(screen.queryByText('연습 한 바퀴를 직접 돌아볼까요?')).not.toBeOnTheScreen();
    expect(posterProps().blocked).toBe(true);

    mockAuth.consentEntry = { status: 'allowed' };
    await view.rerender(<HomeScreen />);
    expect(await screen.findByText('연습 한 바퀴를 직접 돌아볼까요?', {}, { timeout: 2000 })).toBeOnTheScreen();
  });

  test('로그인하지 않았으면 공지 포스터에 그렇게 알린다', async () => {
    mockAuth.user = null;
    await render(<HomeScreen />);
    await screen.findByText('연속 연습 0일');
    expect(posterProps().loggedIn).toBe(false);
  });
});

test('다시 포커스되면 기록을 다시 읽는다', async () => {
  await render(<HomeScreen />);
  await screen.findByText('연속 연습 0일');
  listPracticeGroups.mockResolvedValue({ groups: [group({ title: '새 기록' })] });
  await act(async () => void mockFocusEffect());
  expect(await screen.findByText('새 기록')).toBeOnTheScreen();
});
