import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ChallengesScreen from '@/app/(tabs)/challenges';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import type { ChallengeCard } from '@/lib/challenge/types';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
let mockFocusEffect: () => void = () => undefined;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { listChallenges: jest.fn(), unreadNotificationCount: jest.fn() } }));

const listChallenges = api.listChallenges as jest.Mock;
const DAY = 24 * 60 * 60 * 1000;
const inThreeDays = () => new Date(Date.now() + 3 * DAY - 60 * 60 * 1000).toISOString();
const yesterday = () => new Date(Date.now() - DAY).toISOString();

function card(over: Partial<ChallengeCard> = {}): ChallengeCard {
  return {
    id: 'c1',
    line: '나는 아직 여기 있어',
    work: '빗속의 집',
    character: '서연',
    scene_note: '비 오는 밤 현관 앞',
    origin: 'member',
    host_name: '윤서',
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: inThreeDays(),
    featured_on: null,
    moderation: 'visible',
    entry_count: 3,
    like_sum: 5,
    participants: [
      { name: '윤서', user_id: 'u1' },
      { name: '태오', user_id: 'u2' },
    ],
    more_count: 2,
    ...over,
  };
}

const today = (over: Partial<ChallengeCard> = {}) =>
  card({
    id: 'today',
    line: '오늘은 내가 주인공이야',
    work: '무대 뒤',
    character: '민재',
    featured_on: '2026-10-20',
    entry_count: 4,
    like_sum: 9,
    ...over,
  });

const page = (challenges: ChallengeCard[], over: { featured?: ChallengeCard | null; next_cursor?: string | null } = {}) => ({
  featured: over.featured ?? null,
  challenges,
  next_cursor: over.next_cursor ?? null,
});

const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const tabButton = (name: string) => screen.getByRole('button', { name });
/** 아이콘 글리프가 이름 앞에 붙는 버튼은 보이는 글자로 끝나는지로 찾는다. */
const endsWith = (label: string) => new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  await AsyncStorage.setItem('acttub.challenge.introSeen', '1');
  (api.unreadNotificationCount as jest.Mock).mockResolvedValue({ count: 0 });
  listChallenges.mockResolvedValue(page([card()], { featured: today() }));
});

describe('인기 탭 첫 화면', () => {
  test('오늘의 챌린지를 맨 위에 크게 두고, 카드마다 대사·작품·인물·메모·주최자·참여자·수와 남은 날을 보여 준다', async () => {
    listChallenges.mockResolvedValue(
      page(
        [
          card(),
          card({
            id: 'c2',
            line: '끝난 대사',
            work: '옛 작품',
            character: null,
            scene_note: null,
            origin: 'team',
            host_name: null,
            ends_at: yesterday(),
            participants: [],
            more_count: 0,
            entry_count: 7,
            like_sum: 12,
          }),
        ],
        { featured: today() },
      ),
    );
    await render(<ChallengesScreen />);

    expect(await screen.findByText('“나는 아직 여기 있어”')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenCalledWith({ tab: 'popular' });
    expect(tabButton('인기')).toBeSelected();

    expect(screen.getByText('🔥 오늘의 챌린지 · D-3')).toBeOnTheScreen();
    expect(screen.getByText('“오늘은 내가 주인공이야”')).toBeOnTheScreen();
    expect(screen.getByText('무대 뒤 · 민재')).toBeOnTheScreen();
    expect(screen.getByText('참여작 4 · 좋아요 9')).toBeOnTheScreen();

    expect(screen.getByText('빗속의 집 · 서연')).toBeOnTheScreen();
    expect(screen.getByText('비 오는 밤 현관 앞')).toBeOnTheScreen();
    expect(screen.getByText('윤서 님이 연 대사')).toBeOnTheScreen();
    expect(screen.getByText('윤서 · 태오 +2')).toBeOnTheScreen();
    expect(screen.getByText('참여작 3 · 좋아요 5 · D-3')).toBeOnTheScreen();
    expect(screen.getAllByText('윤')).toHaveLength(2);
    expect(screen.getAllByText('태')).toHaveLength(2);

    expect(screen.getByText('옛 작품')).toBeOnTheScreen();
    expect(screen.getByText('Acttub 공식 대사')).toBeOnTheScreen();
    expect(screen.getByText('아직 참여한 배우가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('참여작 7 · 좋아요 12 · 종료')).toBeOnTheScreen();

    expect(screen.getAllByRole('button', { name: endsWith('나도 이 대사 연기하기') })).toHaveLength(2);
    expect(screen.getByRole('button', { name: endsWith('찾는 대사가 없나요? 직접 등록하기') })).toBeOnTheScreen();
    expect(screen.queryByText('진행 중인 챌린지가 아직 없어요.')).not.toBeOnTheScreen();
  });

  test('주최자가 탈퇴한 사용자 개설 대사는 그렇게 보인다', async () => {
    listChallenges.mockResolvedValue(page([card({ host_name: '  ' })]));
    await render(<ChallengesScreen />);
    expect(await screen.findByText('주최자 탈퇴')).toBeOnTheScreen();
  });

  test('카드를 누르면 상세로, 연기하기를 누르면 그 대사를 실어 촬영으로 간다', async () => {
    listChallenges.mockResolvedValue(page([card()]));
    await render(<ChallengesScreen />);
    await fireEvent.press(await screen.findByText('“나는 아직 여기 있어”'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-detail', params: { id: 'c1' } });
    expect(logged('challenge_open_detail')).toEqual([{ id: 'c1' }]);

    await fireEvent.press(screen.getByRole('button', { name: endsWith('나도 이 대사 연기하기') }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'c1', line: '나는 아직 여기 있어', work: '빗속의 집' },
    });
    expect(logged('challenge_perform_tap')).toEqual([{ id: 'c1' }]);
  });
});

describe('오늘의 챌린지', () => {
  test('참여작 보기는 참여작이 있으면 그 챌린지 피드로 간다. 대사를 누르면 상세로 간다', async () => {
    await render(<ChallengesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: endsWith('참여작 보기') }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-play', params: { id: 'today' } });

    await fireEvent.press(screen.getByText('“오늘은 내가 주인공이야”'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-detail', params: { id: 'today' } });
  });

  test('참여작이 아직 없으면 참여작 보기가 상세로 간다', async () => {
    listChallenges.mockResolvedValue(page([], { featured: today({ entry_count: 0, character: null }) }));
    await render(<ChallengesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: endsWith('참여작 보기') }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/challenge-detail', params: { id: 'today' } });
    expect(screen.getByText('무대 뒤')).toBeOnTheScreen();
    expect(screen.queryByText('진행 중인 챌린지가 아직 없어요.')).not.toBeOnTheScreen();
  });

  test('오늘의 챌린지에서 연기하기를 누르면 촬영으로 간다', async () => {
    listChallenges.mockResolvedValue(page([], { featured: today() }));
    await render(<ChallengesScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: endsWith('나도 이 대사 연기하기') }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'today', line: '오늘은 내가 주인공이야', work: '무대 뒤' },
    });
  });
});

test('머리줄의 알림·추가와 검색·등록 버튼은 각 화면으로 간다', async () => {
  await render(<ChallengesScreen />);
  await screen.findByText('“나는 아직 여기 있어”');

  await fireEvent.press(screen.getByRole('button', { name: '알림' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/notifications');

  // 추가 버튼은 이름 없는 아이콘 버튼이라 알림 바로 다음 버튼으로 찾는다.
  const buttons = screen.getAllByRole('button');
  await fireEvent.press(buttons[buttons.indexOf(screen.getByRole('button', { name: '알림' })) + 1]);
  expect(mockRouter.push).toHaveBeenLastCalledWith('/line-new');

  await fireEvent.press(screen.getByRole('button', { name: endsWith('대사·작품·배우 검색') }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/line-search');

  mockRouter.push.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: endsWith('찾는 대사가 없나요? 직접 등록하기') }));
  expect(mockRouter.push).toHaveBeenCalledWith('/line-new');
});

describe('탭', () => {
  test('탭을 바꾸면 그 탭을 처음부터 읽고, 오늘의 챌린지는 인기·최신에만 고정한다', async () => {
    await render(<ChallengesScreen />);
    await screen.findByText('“오늘은 내가 주인공이야”');

    listChallenges.mockResolvedValue(page([], { featured: today() }));
    await fireEvent.press(tabButton('종료'));
    expect(await screen.findByText('종료된 챌린지가 없어요.')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenLastCalledWith({ tab: 'ended' });
    expect(tabButton('종료')).toBeSelected();
    expect(tabButton('인기')).not.toBeSelected();
    expect(screen.queryByText('“오늘은 내가 주인공이야”')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: endsWith('찾는 대사가 없나요? 직접 등록하기') })).toBeOnTheScreen();

    await fireEvent.press(tabButton('내 챌린지'));
    expect(await screen.findByText('아직 참여한 챌린지가 없어요.')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenLastCalledWith({ tab: 'mine' });
    expect(screen.queryByRole('button', { name: endsWith('찾는 대사가 없나요? 직접 등록하기') })).not.toBeOnTheScreen();

    listChallenges.mockResolvedValue(page([]));
    await fireEvent.press(tabButton('최신'));
    expect(await screen.findByText('진행 중인 챌린지가 아직 없어요.')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenLastCalledWith({ tab: 'latest' });

    expect(logged('challenge_tab')).toEqual([{ tab: 'ended' }, { tab: 'mine' }, { tab: 'latest' }]);
  });

  test('최신 탭도 오늘의 챌린지를 맨 위에 둔다', async () => {
    await render(<ChallengesScreen />);
    await screen.findByText('“오늘은 내가 주인공이야”');
    listChallenges.mockResolvedValue(page([card({ id: 'n1', line: '새 대사' })], { featured: today() }));
    await fireEvent.press(tabButton('최신'));
    expect(await screen.findByText('“새 대사”')).toBeOnTheScreen();
    expect(screen.getByText('“오늘은 내가 주인공이야”')).toBeOnTheScreen();
  });

  test('탭으로 돌아올 때마다 목록을 새로 읽는다', async () => {
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');
    listChallenges.mockResolvedValue(page([card({ line: '돌아와 보니 바뀐 대사' })]));
    await act(async () => mockFocusEffect());
    expect(await screen.findByText('“돌아와 보니 바뀐 대사”')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenCalledTimes(2);
  });
});

describe('목록을 못 불러오면', () => {
  test.each([
    ['게스트·회원 전용', new ApiError(403, '회원만', 'member_only', 'member_only'), '챌린지는 회원만 이용할 수 있어요.'],
    ['연결 끊김', new ApiError(503, '점검', 'unavailable', 'unavailable'), '연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.'],
    ['그 밖의 오류', new ApiError(400, '잘못', 'validation_failed', 'validation_failed'), '챌린지를 불러오지 못했어요.'],
  ])('%s: 이유를 보여 주고 빈 안내·오늘의 챌린지는 띄우지 않는다', async (_name, error, message) => {
    listChallenges.mockRejectedValue(error);
    await render(<ChallengesScreen />);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByText('진행 중인 챌린지가 아직 없어요.')).not.toBeOnTheScreen();
    expect(screen.queryByText('“오늘은 내가 주인공이야”')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '대사 더 보기' })).not.toBeOnTheScreen();
  });
});

describe('대사 더 보기', () => {
  test('다음 20개를 이어 붙이고, 더 없으면 버튼이 사라진다', async () => {
    listChallenges.mockResolvedValueOnce(page([card()], { next_cursor: 'cur-1' }));
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');

    listChallenges.mockResolvedValueOnce(page([card({ id: 'c2', line: '두 번째 장의 대사' })]));
    await fireEvent.press(screen.getByRole('button', { name: '대사 더 보기' }));

    expect(await screen.findByText('“두 번째 장의 대사”')).toBeOnTheScreen();
    expect(screen.getByText('“나는 아직 여기 있어”')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenLastCalledWith({ tab: 'popular', cursor: 'cur-1' });
    expect(screen.queryByRole('button', { name: '대사 더 보기' })).not.toBeOnTheScreen();
  });

  test('받는 동안 버튼을 막아 두 번 눌러도 한 번만 부른다', async () => {
    listChallenges.mockResolvedValueOnce(page([card()], { next_cursor: 'cur-1' }));
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');

    let resolve: (v: unknown) => void = () => undefined;
    listChallenges.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const more = screen.getByRole('button', { name: '대사 더 보기' });
    await fireEvent.press(more);
    expect(screen.queryByText('대사 더 보기')).not.toBeOnTheScreen();
    await fireEvent.press(more);
    expect(listChallenges).toHaveBeenCalledTimes(2);

    await act(async () => resolve(page([card({ id: 'c2', line: '늦게 온 대사' })], { next_cursor: 'cur-2' })));
    expect(screen.getByText('“늦게 온 대사”')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '대사 더 보기' })).toBeOnTheScreen();
  });

  test('이어 받기가 실패하면 이유를 보여 주고 받은 목록은 둔다', async () => {
    listChallenges.mockResolvedValueOnce(page([card()], { next_cursor: 'cur-1' }));
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');

    listChallenges.mockRejectedValueOnce(new ApiError(410, '만료', 'cursor_expired', 'cursor_expired'));
    await fireEvent.press(screen.getByRole('button', { name: '대사 더 보기' }));

    expect(await screen.findByText('순위가 바뀌었어요. 다시 불러올게요.')).toBeOnTheScreen();
    expect(screen.getByText('“나는 아직 여기 있어”')).toBeOnTheScreen();
  });

  test('받는 중에 탭을 바꾸면 늦게 온 옛 탭의 결과를 버린다', async () => {
    listChallenges.mockResolvedValueOnce(page([card()], { next_cursor: 'cur-1' }));
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');

    let resolve: (v: unknown) => void = () => undefined;
    listChallenges.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await fireEvent.press(screen.getByRole('button', { name: '대사 더 보기' }));

    listChallenges.mockResolvedValueOnce(page([card({ id: 'e1', line: '종료 탭 대사', ends_at: yesterday() })]));
    await fireEvent.press(tabButton('종료'));
    expect(await screen.findByText('“종료 탭 대사”')).toBeOnTheScreen();

    await act(async () => resolve(page([card({ id: 'p2', line: '인기 탭 두 번째 장' })], { next_cursor: 'cur-2' })));
    expect(screen.queryByText('“인기 탭 두 번째 장”')).not.toBeOnTheScreen();
    expect(screen.getByText('“종료 탭 대사”')).toBeOnTheScreen();
  });
});

describe('보관함에서 올릴 챌린지를 고르러 왔을 때', () => {
  beforeEach(() => {
    mockParams = { pickVideoId: 'v9' };
  });

  test('제목이 바뀌고, 연기하기를 누르면 고른 영상을 그 챌린지 올리기 화면으로 보낸다', async () => {
    await render(<ChallengesScreen />);
    expect(await screen.findByText('어떤 대사에 올릴까요?')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: endsWith('참여작 보기') })).not.toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: endsWith('나도 이 대사 연기하기') })[1]);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'c1', videoId: 'v9' },
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(logged('challenge_pick_for_video')).toEqual([{ id: 'c1' }]);
    expect(logged('challenge_perform_tap')).toEqual([]);
  });

  test('빈 영상 id 는 고르기로 보지 않는다', async () => {
    mockParams = { pickVideoId: '' };
    await render(<ChallengesScreen />);
    expect(await screen.findByText('챌린지')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: endsWith('참여작 보기') })).toBeOnTheScreen();
  });
});

describe('시작 안내', () => {
  test('기기에서 처음 들어오면 세 장을 넘겨 보고, 시작하면 다시 띄우지 않게 적어 둔다', async () => {
    await AsyncStorage.removeItem('acttub.challenge.introSeen');
    await render(<ChallengesScreen />);

    expect(await screen.findByText('같은 대사, 다른 연기')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText('위아래로 넘겨 보세요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText('좋아요로 순위가 정해져요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '시작하기' }));

    await waitFor(() => expect(screen.queryByText('좋아요로 순위가 정해져요')).not.toBeOnTheScreen());
    expect(await AsyncStorage.getItem('acttub.challenge.introSeen')).toBe('1');
  });

  test('이미 본 기기에서는 띄우지 않는다', async () => {
    await render(<ChallengesScreen />);
    await screen.findByText('“나는 아직 여기 있어”');
    expect(screen.queryByText('같은 대사, 다른 연기')).not.toBeOnTheScreen();
  });
});
