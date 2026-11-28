import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler, Linking, Platform, ToastAndroid } from 'react-native';

import HomeScreen from '@/app/(tabs)/index';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { SpotlightHost } from '@/components/spotlight-guide';
import { localDate } from '@/lib/admissions';
import { kstDate } from '@/lib/auditions';
import { api } from '@/lib/api';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { rememberPracticeDays, sessionPracticeDays } from '@/lib/practice-days';
import type { PracticeGroup, PracticeRound } from '@/lib/practice/types';
import type { ScriptCard } from '@/lib/reading/types';
import { readLastSeenStreak, writeLastSeenStreak } from '@/lib/streak-celebration';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
// 화면의 useFocusEffect 전부 — 다시 포커스는 모두 다시 부른다.
const mockFocusEffects = new Set<() => void | (() => void)>();
const mockFocusEffect = () => mockFocusEffects.forEach((effect) => effect());
// 영상 올리는 중 카드 — 테스트가 card 를 채우면 홈이 올리는 카드를 그린다.
const mockWaitingUpload: { card: unknown } = { card: null };
const mockAuth = {
  user: { id: 'u1' } as { id: string } | null,
  consentEntry: { status: 'allowed' },
  // 홈은 프로필 게이트를 지난 뒤(내 계정을 읽은 뒤)에만 그려진다 — 계정 id 는 늘 있다.
  profile: { me: { id: 'u1' } as { id: string; profile?: { experience: string; birth_date: string | null } } },
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
    practiceDays: jest.fn(),
    communityPosts: jest.fn(),
  },
}));
jest.mock('@/lib/community-post-seed', () => ({ seedCommunityPost: jest.fn() }));
jest.mock('@/hooks/use-waiting-upload', () => ({ useWaitingUpload: () => mockWaitingUpload }));
jest.mock('@/components/home-upload-card', () => {
  const { Text } = require('react-native');
  return { HomeUploadCard: () => <Text>올리는 중 카드</Text> };
});
jest.mock('@/hooks/use-unread-notifications', () => ({ useUnreadNotifications: () => ({ count: 0, badge: null }) }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn(async () => null) }));
jest.mock('@/lib/reading/resume-open', () => ({ openResume: jest.fn(async () => 'missing') }));
jest.mock('@/lib/guide-state', () => ({
  hasSeenSpotlight: jest.fn(),
  hasSeenTutorial: jest.fn(),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
  markReadingTutorialSeen: jest.fn(async () => undefined),
}));
// 코칭 끝 화면이 적는 이번 실행의 연습한 날(SOMA-1075). 테스트가 값을 바꾸고 mockSessionDaysChanged 로 알린다.
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
const getPracticeNote = api.getPracticeNote as jest.Mock;
const communityPosts = api.communityPosts as jest.Mock;
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
  mockAuth.user = { id: 'u1' };
  mockAuth.consentEntry = { status: 'allowed' };
  mockAuth.profile = { me: { id: 'u1' } };
  (jest.requireMock('@/lib/practice/first-use-graduation').hasGraduatedFirstUse as jest.Mock).mockImplementation(async () => false);
  listPracticeGroups.mockResolvedValue({ groups: [] });
  listReadingScripts.mockResolvedValue({ scripts: [] });
  (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [] });
  (api.listChallenges as jest.Mock).mockResolvedValue({ featured: null });
  (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [], next_cursor: null });
  getPracticeNote.mockResolvedValue({ next_take: null, report: null });
  (api.admissions as jest.Mock).mockResolvedValue(admissionsPayload);
  (api.auditions as jest.Mock).mockResolvedValue(auditionsPayload);
  (api.practiceDays as jest.Mock).mockResolvedValue({ days: [] });
  communityPosts.mockResolvedValue({ posts: [], next_cursor: null });
  mockWaitingUpload.card = null;
  (hasSeenTutorial as jest.Mock).mockResolvedValue(true);
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
  (rememberPracticeDays as jest.Mock).mockImplementation(async (records: { created_at: string }[]) => records);
  (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
  (sessionPracticeDays as jest.Mock).mockImplementation(() => mockNoSessionDays);
  (jest.requireMock('@/lib/practice/first-use-graduation').graduatedInMemory as jest.Mock).mockImplementation(() => false);
});

describe('첫 사용자', () => {
  test('기록·대본·연습한 날이 없으면 액티 말풍선과 「뭐부터 해 볼까요?」 선택 카드 둘(코칭·리딩)을 보이고, 하나 골라 「다음」을 눌러야 연습 탭의 그쪽으로 간다', async () => {
    await render(<HomeScreen />);

    expect(await screen.findByText('뭐부터 해 볼까요?')).toBeOnTheScreen();
    expect(screen.getByText('하나를 누르면 자세히 알려 드려요')).toBeOnTheScreen();
    expect(screen.getByText('영상을 보여 주면 코치가 질문하며 고칠 점 하나를 같이 찾아요.')).toBeOnTheScreen();
    expect(screen.getByText('상대역 대사를 읽어 줘서 혼자서도 내 대사를 맞춰 봐요.')).toBeOnTheScreen();
    expect(screen.queryByText('이번 주 대사를 연기해요')).not.toBeOnTheScreen();
    await waitFor(() => expect(writeLastSeenStreak).toHaveBeenCalledWith(0));

    // 첫 항목(코칭)을 미리 골라 둔다(UX 가이드 5절, 10/28). 누르기 전엔 넘어가지 않는다.
    expect(screen.getByRole('radio', { name: '연기 코칭을 받아볼래요?', selected: true })).toBeOnTheScreen();
    expect(mockRouter.push).not.toHaveBeenCalled();

    // 누르면 바로 가지 않고 골라 둔다.
    await fireEvent.press(screen.getByRole('radio', { name: '대본 리딩을 받아볼래요?' }));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '대본 리딩을 받아볼래요?', selected: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/practice?mode=reading');
  });

  test('선택지는 코칭·리딩 둘뿐이고(챌린지는 첫 연습 뒤), 코칭을 골라 「다음」을 누르면 연습 탭 코칭으로 간다(SOMA-827)', async () => {
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: '챌린지에 참여해 볼래요?' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: '연기 코칭을 받아볼래요?' }));
    expect(screen.getAllByRole('radio', { selected: true })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/practice?mode=coaching');
  });

  test('이 기기에서 리딩·코칭을 끝까지 해 본 계정은 서버 기록이 비어도 기본 홈이다(SOMA-827)', async () => {
    const { hasGraduatedFirstUse } = jest.requireMock('@/lib/practice/first-use-graduation');
    hasGraduatedFirstUse.mockImplementation(async (id: string) => id === 'u1');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
  });

  test('기본 홈에는 오늘 할 것 카드와 「이것도 해 볼까요?」 줄이 없다 — 리딩·코칭 이어 하기는 연습 탭에 있다', async () => {
    const { hasGraduatedFirstUse } = jest.requireMock('@/lib/practice/first-use-graduation');
    hasGraduatedFirstUse.mockImplementation(async (id: string) => id === 'u1');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    listPracticeGroups.mockResolvedValue({ groups: [group({ title: '카페 장면', practices: [round('p1', isoDaysAgo(2), true)] })] });
    await render(<HomeScreen />);

    expect(await screen.findByText('게시판')).toBeOnTheScreen();
    expect(screen.queryByText('이것도 해 볼까요?')).not.toBeOnTheScreen();
    expect(screen.queryByText('추천 연습')).not.toBeOnTheScreen();
    expect(screen.queryByText('리딩 · 새 대본')).not.toBeOnTheScreen();
    // 오늘 카드용으로 받던 이번 주 챌린지·코칭 노트는 더 받지 않는다.
    expect(api.listChallenges).not.toHaveBeenCalled();
    expect(getPracticeNote).not.toHaveBeenCalled();
  });

  test('기본 홈 맨 아래에 인스타 계정·메일 주소가 있고, 인스타를 누르면 프로필이 열린다(11/3)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { hasGraduatedFirstUse } = jest.requireMock('@/lib/practice/first-use-graduation');
    hasGraduatedFirstUse.mockImplementation(async (id: string) => id === 'u1');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<HomeScreen />);

    const insta = await screen.findByRole('link', { name: '인스타그램 @acttub_com 프로필 열기' });
    expect(screen.getByText(/메일 acttub0527@gmail\.com/)).toBeOnTheScreen();
    await fireEvent.press(insta);
    expect(openURL).toHaveBeenCalledWith('https://www.instagram.com/acttub_com/');
  });

  test('기본 홈 연락처 바로 위에 「의견 보내기」 한 줄이 있고, 누르면 의견 보내기로 간다(SOMA-953)', async () => {
    const { hasGraduatedFirstUse } = jest.requireMock('@/lib/practice/first-use-graduation');
    hasGraduatedFirstUse.mockImplementation(async (id: string) => id === 'u1');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막' })] });
    await render(<HomeScreen />);

    const row = await screen.findByRole('button', { name: '의견 보내기' });
    expect(row.props['ph-label']).toBe('home_row_feedback');
    expect(screen.getByText('불편한 점이나 바라는 기능을 알려 주세요')).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenLastCalledWith('/feedback');
  });

  test('기록으로 첫 사용자를 벗어나면 졸업 표시를 남긴다 — 다시 읽기 시작해 대본이 「연습 중」이 돼도 첫 홈으로 돌아가지 않게(11/2)', async () => {
    const { markFirstUseGraduated } = jest.requireMock('@/lib/practice/first-use-graduation');
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막', status: 'completed' })] });
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    await waitFor(() => expect(markFirstUseGraduated).toHaveBeenCalledWith('u1'));
  });

  test('14일보다 전에 끝까지 읽은 대본만 있는 사람도 첫 사용자가 아니다(11/2)', async () => {
    const { markFirstUseGraduated } = jest.requireMock('@/lib/practice/first-use-graduation');
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    listReadingScripts.mockResolvedValue({ scripts: [script({ title: '갈매기 2막', status: 'reading', last_practiced_at: old })] });
    (api.listReadingSessions as jest.Mock).mockResolvedValue({ sessions: [{ status: 'completed', started_at: old, progress: { total: 10, done: 10 } }] });
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    expect(markFirstUseGraduated).toHaveBeenCalledWith('u1');
  });

  test('대본 목록을 못 받으면 첫 사용자로 보지 않는다(11/2)', async () => {
    listReadingScripts.mockRejectedValue(new Error('network'));
    await render(<HomeScreen />);

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
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

  test('묶음을 못 받으면 첫 사용자로 보지 않는다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);
    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([], 'u1');
  });
});

describe('게시판 · 인기 글', () => {
  const { logEvent } = jest.requireMock('@/lib/analytics') as { logEvent: jest.Mock };
  const { seedCommunityPost } = jest.requireMock('@/lib/community-post-seed') as { seedCommunityPost: jest.Mock };
  const post = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    category_slug: 'free',
    category_name: '자유',
    title: `${id} 제목`,
    body: `${id} 본문 첫 줄\n둘째 줄`,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    created_at: isoDaysAgo(1),
    ...over,
  });

  test('칸(자유·질문·홍보)마다 최신 글 한 줄을 두고, 글 없는 칸은 빼며, 누르면 그 글을 연다', async () => {
    practiced();
    communityPosts.mockResolvedValue({
      posts: [
        post('f1', { title: '자유 최신', created_at: isoDaysAgo(0.1) }),
        post('q1', { category_slug: 'question', category_name: '질문', title: '질문 최신', created_at: isoDaysAgo(0.5) }),
        post('f0', { title: '자유 예전', created_at: isoDaysAgo(2) }),
      ],
      next_cursor: null,
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('자유 최신')).toBeOnTheScreen();
    expect(screen.getByText('질문 최신')).toBeOnTheScreen();
    expect(screen.queryByText('자유 예전')).not.toBeOnTheScreen();
    expect(screen.queryByText('홍보')).not.toBeOnTheScreen();
    expect(communityPosts).toHaveBeenCalledTimes(1);
    expect(communityPosts).toHaveBeenCalledWith({ limit: 30 });

    await fireEvent.press(screen.getByRole('button', { name: '질문 · 질문 최신' }));
    expect(seedCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/community-post', params: { id: 'q1' } });
    expect(logEvent).toHaveBeenCalledWith('home_board_open', { from: 'latest' });

    await fireEvent.press(screen.getByRole('link', { name: '게시판 더 보기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/community');
    expect(logEvent).toHaveBeenCalledWith('home_board_open', { from: 'more' });
  });

  test('인기 글은 최근 14일 글 중 좋아요+댓글 많은 순 둘이고, 칸 · ♡ · 댓글 수와 본문 첫 줄을 보인다', async () => {
    practiced();
    communityPosts.mockResolvedValue({
      posts: [
        post('a', { title: '조금 인기', like_count: 1, comment_count: 1 }),
        post('b', { category_slug: 'promo', category_name: '홍보', title: '제일 인기', like_count: 4, comment_count: 3, created_at: isoDaysAgo(3) }),
        post('c', { title: '중간 인기', like_count: 2, comment_count: 1, created_at: isoDaysAgo(2) }),
        post('old', { title: '오래된 인기', like_count: 99, comment_count: 99, created_at: isoDaysAgo(20) }),
      ],
      next_cursor: null,
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('인기 글')).toBeOnTheScreen();
    expect(screen.getByText('홍보 · ♡ 4 · 댓글 3')).toBeOnTheScreen();
    expect(screen.getByText('자유 · ♡ 2 · 댓글 1')).toBeOnTheScreen();
    expect(screen.getByText('b 본문 첫 줄 둘째 줄')).toBeOnTheScreen();
    expect(screen.queryByText('오래된 인기')).not.toBeOnTheScreen();
    expect(screen.queryByText('자유 · ♡ 1 · 댓글 1')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByText('중간 인기'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/community-post', params: { id: 'c' } });
    expect(logEvent).toHaveBeenCalledWith('home_board_open', { from: 'popular' });
  });

  test('좋아요·댓글이 하나도 없는 글뿐이면 인기 글 구역을 숨긴다', async () => {
    practiced();
    communityPosts.mockResolvedValue({ posts: [post('a'), post('b', { category_slug: 'question', category_name: '질문' })], next_cursor: null });
    await render(<HomeScreen />);

    expect(await screen.findByText('a 제목')).toBeOnTheScreen();
    expect(screen.queryByText('인기 글')).not.toBeOnTheScreen();
  });

  test('글이 하나도 없으면 「첫 글을 남겨 보세요」와 글쓰기 버튼을 보이고, 누르면 글쓰기로 간다', async () => {
    practiced();
    await render(<HomeScreen />);

    expect(await screen.findByText('첫 글을 남겨 보세요')).toBeOnTheScreen();
    expect(screen.queryByText('인기 글')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '글쓰기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/community-new');
    expect(logEvent).toHaveBeenCalledWith('home_board_empty_write');
  });

  test('게스트(403 member_only)는 두 구역 대신 가입 안내 한 줄만 본다', async () => {
    practiced();
    const { ApiError } = jest.requireActual('@/lib/api-request');
    communityPosts.mockRejectedValue(new ApiError(403, 'member_only', 'member_only'));
    await render(<HomeScreen />);

    expect(await screen.findByText('가입하면 게시판을 볼 수 있어요')).toBeOnTheScreen();
    expect(screen.queryByText('인기 글')).not.toBeOnTheScreen();
    expect(screen.queryByText('다시 시도')).not.toBeOnTheScreen();
    expect(screen.queryByText('더 보기')).not.toBeOnTheScreen();
  });

  test('받기에 실패하면 게시판 구역에 실패 줄과 다시 시도를 두고, 누르면 다시 받는다', async () => {
    practiced();
    communityPosts.mockRejectedValueOnce(new Error('network'));
    await render(<HomeScreen />);

    expect(await screen.findByText('게시판을 불러오지 못했어요')).toBeOnTheScreen();
    communityPosts.mockResolvedValue({ posts: [post('f1', { title: '다시 받은 글' })], next_cursor: null });
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText('다시 받은 글')).toBeOnTheScreen();
    expect(communityPosts).toHaveBeenCalledTimes(2);
  });

  test('받는 동안은 게시판 줄 모양 뼈대를 보인다', async () => {
    practiced();
    communityPosts.mockReturnValue(new Promise(() => undefined));
    await render(<HomeScreen />);

    expect(await screen.findByText('게시판')).toBeOnTheScreen();
    expect(screen.getAllByTestId('home-board-skeleton')).toHaveLength(3);
  });

  test('홈에 다시 오면 게시판을 다시 받는다', async () => {
    practiced();
    await render(<HomeScreen />);
    await screen.findByText('첫 글을 남겨 보세요');
    communityPosts.mockResolvedValue({ posts: [post('f1', { title: '새로 올라온 글' })], next_cursor: null });
    await act(async () => void mockFocusEffect());
    expect(await screen.findByText('새로 올라온 글')).toBeOnTheScreen();
  });

  test('영상을 올리는 중이면 올리는 카드는 그대로 남고 게시판도 보인다', async () => {
    practiced();
    mockWaitingUpload.card = { state: 'uploading' };
    await render(<HomeScreen />);

    expect(await screen.findByText('올리는 중 카드')).toBeOnTheScreen();
    expect(screen.getByText('게시판')).toBeOnTheScreen();
  });
});

describe('연속 연습', () => {
  test('오늘 처음 연습했으면 한 번 축하하고, 계속하기를 누르면 닫는다', async () => {
    listPracticeGroups.mockResolvedValue({
      // 노트가 생긴 오늘 회차 하나(시각 없는 회차는 빼고)가 연습 1회다(SOMA-773).
      groups: [group({ practices: [round('p-today', isoDaysAgo(0), true), round('p-blank', '', true)] })],
    });
    await render(<HomeScreen />);

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([{ created_at: expect.any(String) }], 'u1');
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

  test('앱을 새로 깔아 저장값이 0 이어도, 오늘 연습이 없으면 어제까지의 연속일로 축하하지 않는다', async () => {
    (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
    listPracticeGroups.mockResolvedValue({
      groups: [group({ practices: [round('p-yesterday', isoDaysAgo(1), true)] })],
    });
    await render(<HomeScreen />);

    await waitFor(() => expect(writeLastSeenStreak).toHaveBeenLastCalledWith(1));
    expect(screen.queryByLabelText('1일 연속 연습 축하')).not.toBeOnTheScreen();
  });

  test('기록을 못 받아도 기기에 쌓인 연습일로 연속일을 센다', async () => {
    listPracticeGroups.mockRejectedValue(new Error('down'));
    (rememberPracticeDays as jest.Mock).mockResolvedValue([{ created_at: isoDaysAgo(0) }, { created_at: isoDaysAgo(1) }]);
    (readLastSeenStreak as jest.Mock).mockResolvedValue(1);
    await render(<HomeScreen />);

    expect(await screen.findByLabelText('2일 연속 연습 축하')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledWith([], 'u1');
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

describe('마감 임박과 이번 주 연습', () => {
  const coachingGroup = (at: string) =>
    group({ title: '카페 장면', last_practiced_at: at, practices: [round('p1', at, true)] });

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
    mockAuth.profile = { me: { id: 'u1', profile: { experience: 'exam_prep', birth_date: `${new Date().getFullYear() - 18}-01-01` } } };
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
    expect(await screen.findByText('게시판')).toBeOnTheScreen();
    expect(screen.queryByText('오디션 마감 임박')).not.toBeOnTheScreen();
  });

  test('서버가 센 지난 연습일까지 누적 일수에 넣는다 (SOMA-1003)', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    const kstDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
    // 오늘(기기 기록과 겹침) + 30일·40일 전(앱이 따로 안 읽는 오래된 날).
    (api.practiceDays as jest.Mock).mockResolvedValue({ days: [kstDay(40), kstDay(30), kstDay(0)] });
    await render(<HomeScreen />);

    expect(await screen.findByText('이번 주 1일 · 누적 3일')).toBeOnTheScreen();
    expect(screen.getByLabelText('이번 주 1일 연습, 지금까지 3일 연습')).toBeOnTheScreen();
  });

  test('연속이 끊겼어도 누적 일수는 보인다 (SOMA-1003)', async () => {
    const kstDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
    (api.practiceDays as jest.Mock).mockResolvedValue({ days: [kstDay(20), kstDay(10), kstDay(5)] });
    await render(<HomeScreen />);

    // 5일 전만 이번 주 7칸 안이다.
    expect(await screen.findByText('이번 주 1일 · 누적 3일')).toBeOnTheScreen();
    expect(screen.queryByText(/일째!/)).not.toBeOnTheScreen();
  });

  // 11/2 폰 QA — 오프라인으로 켜면 홈이 팝업 뒤에서 기록 읽기에 실패한 채 남았다. 게이트가 열리면 다시 읽는다.
  test('동의·프로필 게이트가 열리는 순간 홈에 있으면 기록을 다시 읽는다', async () => {
    mockAuth.consentEntry = { status: 'error' };
    (mockAuth.profile as { status?: string }).status = 'error';
    listPracticeGroups.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<HomeScreen />);
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(1));

    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    mockAuth.consentEntry = { status: 'allowed' };
    (mockAuth.profile as { status?: string }).status = 'complete';
    await view.rerender(<HomeScreen />);
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  // 11/3 측정 — 앱을 켤 때마다 동의 확인이 끝나는 순간 같은 기록(묶음·대본·참여작·연습일)을 한 번 더 받았다.
  test('게이트 전에 읽은 기록을 이 계정으로 다 받았으면 게이트가 열려도 다시 읽지 않는다', async () => {
    mockAuth.consentEntry = { status: 'checking' };
    (mockAuth.profile as { status?: string }).status = 'complete';
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    const view = await render(<HomeScreen />);
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();

    mockAuth.consentEntry = { status: 'allowed' };
    await view.rerender(<HomeScreen />);
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(listPracticeGroups).toHaveBeenCalledTimes(1);
    expect(screen.getByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  test('게이트가 열릴 때 기록을 받는 중이면 끝나기를 기다렸다가, 실패했을 때만 다시 읽는다', async () => {
    mockAuth.consentEntry = { status: 'checking' };
    (mockAuth.profile as { status?: string }).status = 'complete';
    let fail: (error: Error) => void = () => undefined;
    listPracticeGroups.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const view = await render(<HomeScreen />);
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(1));

    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    mockAuth.consentEntry = { status: 'allowed' };
    await view.rerender(<HomeScreen />);
    await act(async () => undefined);
    expect(listPracticeGroups).toHaveBeenCalledTimes(1);

    await act(async () => fail(new Error('consent required')));
    await waitFor(() => expect(listPracticeGroups).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  test('연습일 목록을 못 받아도 홈은 그대로 연다 (SOMA-1003)', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    (api.practiceDays as jest.Mock).mockRejectedValue(new Error('down'));
    await render(<HomeScreen />);

    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
  });

  test('이번 주·누적 일수와 요일 원 일곱 개를 보이고, 연습한 날은 그날 횟수를 보인다', async () => {
    listPracticeGroups.mockResolvedValue({ groups: [coachingGroup(isoDaysAgo(0))] });
    (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({ entries: [{ id: 'e1', created_at: isoDaysAgo(0) }], next_cursor: null });
    await render(<HomeScreen />);

    expect(await screen.findByText('이번 주 1일 · 누적 1일')).toBeOnTheScreen();
    expect(screen.queryByText(/일째!/)).not.toBeOnTheScreen();
    expect(screen.getByText('오늘')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^home-week-/)).toHaveLength(7);
    // 오늘 코칭 1번 + 챌린지 1번 = 2번.
    const done = screen.getAllByTestId('home-week-done');
    expect(done).toHaveLength(1);
    expect(done[0]).toHaveTextContent('2');
    expect(screen.getByLabelText('오늘 연습 2번')).toBeOnTheScreen();
    expect(screen.getAllByTestId('home-week-empty')).toHaveLength(6);
    expect(screen.getAllByLabelText(/연습 없음$/)).toHaveLength(6);
    // 홈의 이번 주 카드는 원이 그날 횟수만큼 차오르는 공용 카드다(components/week-practice-card).
    expect(screen.getAllByTestId('week-fill')).toHaveLength(1);
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

  test('연습이 쌓인 계정(앱을 다시 깐 기존 사용자)에게는 「첫 연습 끝!」 안내를 띄우지 않고 본 것으로 적는다(10/26)', async () => {
    listPracticeGroups.mockResolvedValue({
      groups: [
        group({
          title: '카페 장면',
          practices: [round('r1', isoDaysAgo(1), true), round('r2', isoDaysAgo(2), true), round('r3', isoDaysAgo(3), true)],
        }),
      ],
    });
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    await screen.findByText('게시판');
    await waitFor(() => expect(markSpotlightSeen).toHaveBeenCalledWith('home'));
    await act(async () => new Promise((r) => setTimeout(r, 900)));
    expect(screen.queryByText('건너뛰기')).not.toBeOnTheScreen();
  });

  test('첫 연습을 끝낸 홈에서 안내를 띄우고, 안내를 본 그 방문에는 공지 포스터를 미룬다', async () => {
    practiced();
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    await render(withHost);

    expect(hasSeenSpotlight).toHaveBeenCalledWith('home');
    // 첫 단계는 홈 카드가 아니라 하단 바 연습 탭을 가리키는 문구다(게시판 홈). 리딩 안내를 합쳐 모두 세 단계다.
    expect(await screen.findByText('잘했어요. 다음 연습은 여기 연습 탭에서 해요. 코칭이랑 리딩 중에 골라서 할 수 있어요.', {}, { timeout: 2000 })).toBeOnTheScreen();
    expect(screen.getByText('액티 · 1/3')).toBeOnTheScreen();
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

  test('재동의 팝업이 떠 있는 동안은 첫 안내를 미루고, 닫힌 뒤에 띄운다', async () => {
    practiced();
    (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
    mockAuth.consentEntry = { status: 'required' };
    const view = await render(withHost);
    await screen.findByText('게시판');
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

// 당기기 제스처는 ScrollView 의 refreshControl 이 받는다. 테스트 렌더러에는 제스처가 없어 그 요소를 꺼내 직접 다룬다.
const homeRefresh = () =>
  screen.container.queryAll((node) => node.props.refreshControl !== undefined)[0].props.refreshControl;

test('기본 홈 맨 위에서 당기면 기록과 게시판을 다시 읽고 표시가 사라지며, 첫 안내는 다시 묻지 않는다', async () => {
  listPracticeGroups.mockResolvedValue({
    groups: [group({ root_id: 'r1', title: '카페 장면', practices: [round('p1', isoDaysAgo(0), true)] })],
  });
  await render(<HomeScreen />);
  expect(await screen.findByText('첫 글을 남겨 보세요')).toBeOnTheScreen();
  expect(homeRefresh().props.refreshing).toBe(false);
  const tutorialAsks = (hasSeenTutorial as jest.Mock).mock.calls.length;

  let resolve: (v: unknown) => void = () => undefined;
  listPracticeGroups.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  communityPosts.mockResolvedValue({
    posts: [{ id: 'n1', category_slug: 'free', category_name: '자유', title: '당겨서 받은 글', body: '', like_count: 0, comment_count: 0, liked_by_me: false, created_at: isoDaysAgo(0) }],
    next_cursor: null,
  });
  await act(async () => homeRefresh().props.onRefresh());
  expect(homeRefresh().props.refreshing).toBe(true);
  expect(listPracticeGroups).toHaveBeenCalledTimes(2);
  expect(communityPosts).toHaveBeenCalledTimes(2);

  await act(async () => resolve({ groups: [] }));
  await waitFor(() => expect(homeRefresh().props.refreshing).toBe(false));
  expect(screen.getByText('당겨서 받은 글')).toBeOnTheScreen();
  expect((hasSeenTutorial as jest.Mock).mock.calls.length).toBe(tutorialAsks);
});

// SOMA-1075 — 첫 코칭을 마치고 홈으로 오면 첫 사용자 홈이 잠깐 보이고 불꽃이 늦게 떴다.
describe('첫 코칭을 마치고 돌아올 때', () => {
  const graduateInMemory = async () => {
    const graduation = jest.requireMock('@/lib/practice/first-use-graduation');
    const actual = jest.requireActual('@/lib/practice/first-use-graduation');
    graduation.graduatedInMemory.mockImplementation((id: string) => id === 'u1');
    // 코칭 끝 화면이 부르는 것과 같은 신호 — 탭바와 홈이 같이 듣는다.
    await act(async () => actual.markFirstUseGraduated('u1'));
  };

  test('홈이 다시 포커스를 받지 않아도 졸업 신호로 첫 사용자 홈이 사라진다', async () => {
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    const focusRuns = (hasSeenTutorial as jest.Mock).mock.calls.length;

    await graduateInMemory();

    expect(await screen.findByText('오늘도\n연기하는 하루,\n멋져요!')).toBeOnTheScreen();
    expect(screen.queryByText('뭐부터 해 볼까요?')).not.toBeOnTheScreen();
    // 포커스 효과(기록 다시 받기)를 거치지 않았다.
    expect(hasSeenTutorial).toHaveBeenCalledTimes(focusRuns);
  });

  test('코칭 끝 화면이 적은 오늘 시작한 회차로 서버 기록을 다시 받기 전에 불꽃을 띄우고, 기기 저장소에는 넣지 않는다', async () => {
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    const today = [{ created_at: isoDaysAgo(0) }];

    (sessionPracticeDays as jest.Mock).mockImplementation((id: string) => (id === 'u1' ? today : mockNoSessionDays));
    await act(async () => mockSessionDaysChanged());
    await graduateInMemory();

    expect(await screen.findByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).toBeOnTheScreen();
    expect(rememberPracticeDays).toHaveBeenCalledTimes(1);
    expect(rememberPracticeDays).toHaveBeenCalledWith([], 'u1');
  });

  test('자정 전에 시작한 회차면 그 날로 세고, 오늘 연습이 아니라 불꽃은 띄우지 않는다', async () => {
    (readLastSeenStreak as jest.Mock).mockResolvedValue(0);
    await render(<HomeScreen />);
    await screen.findByText('뭐부터 해 볼까요?');
    const yesterday = [{ created_at: isoDaysAgo(1) }];

    (sessionPracticeDays as jest.Mock).mockImplementation((id: string) => (id === 'u1' ? yesterday : mockNoSessionDays));
    await act(async () => mockSessionDaysChanged());
    await graduateInMemory();

    await screen.findByText('오늘도\n연기하는 하루,\n멋져요!');
    await waitFor(() => expect(writeLastSeenStreak).toHaveBeenLastCalledWith(1));
    expect(screen.queryByText('첫 불꽃이 켜졌어요\n내일도 연습하면 2일이에요')).not.toBeOnTheScreen();
  });
});
