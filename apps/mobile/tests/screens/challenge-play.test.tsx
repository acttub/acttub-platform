import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import ChallengePlayScreen from '@/app/challenge-play';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import type { ChallengeDetail, EntryCard, EntryComment } from '@/lib/challenge/types';

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
let mockFocused = true;
let mockUser: { id: string } | null = { id: 'me' };
let mockStatusListener: (e: { status: string }) => void = () => undefined;
const mockPlayer = {
  loop: false,
  muted: false,
  status: 'readyToPlay',
  currentTime: 10,
  play: jest.fn(),
  pause: jest.fn(),
  replaceAsync: jest.fn(),
  addListener: jest.fn((_event: string, fn: (e: { status: string }) => void) => {
    mockStatusListener = fn;
    return { remove: jest.fn() };
  }),
};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup?: (p: unknown) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  },
  VideoView: () => null,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
const mockSystemShare = jest.fn();
jest.mock('@/lib/challenge/share-native', () => ({
  videoDeps: { download: jest.fn(), remove: jest.fn() },
  isInstagramInstalled: jest.fn(async () => true),
  instagramStoreUrl: jest.fn(() => null),
  shareVideoToInstagramStory: jest.fn(),
  saveVideoToLibrary: jest.fn(),
  copyText: jest.fn(),
  openSystemShare: (message: string) => mockSystemShare(message),
  openUrl: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/api', () => ({
  api: {
    getEntry: jest.fn(),
    getChallenge: jest.fn(),
    listChallengeEntries: jest.fn(),
    recordEntryView: jest.fn(),
    likeEntry: jest.fn(),
    saveEntry: jest.fn(),
    blockUser: jest.fn(),
    createReport: jest.fn(),
    listComments: jest.fn(),
    createComment: jest.fn(),
    deleteComment: jest.fn(),
  },
}));

const mocked = api as unknown as Record<keyof typeof api, jest.Mock>;
const DAY = 24 * 60 * 60 * 1000;
const HEIGHT = Dimensions.get('window').height;

function challenge(over: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return {
    id: 'c1',
    line: '나는 아직 여기 있어',
    work: '빗속의 집',
    character: '서연',
    scene_note: null,
    origin: 'member',
    host_name: '윤서',
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: new Date(Date.now() + 3 * DAY).toISOString(),
    featured_on: null,
    moderation: 'visible',
    entry_count: 2,
    like_sum: 5,
    participants: [],
    more_count: 0,
    ranking_state: null,
    ...over,
  };
}

function entry(over: Partial<EntryCard> = {}): EntryCard {
  return {
    id: 'e1',
    challenge_id: 'c1',
    author: { name: '민지', user_id: 'u-minji' },
    caption: '첫 테이크',
    like_count: 3,
    comment_count: 2,
    view_count: 10,
    rank: 1,
    final_like_count: null,
    published_at: '2026-10-10T00:00:00Z',
    playback_url: 'https://play/e1',
    liked: false,
    saved: false,
    is_mine: false,
    is_new: false,
    ...over,
  };
}

const second = (over: Partial<EntryCard> = {}) =>
  entry({ id: 'e2', author: { name: '태오', user_id: 'u-taeo' }, caption: null, playback_url: 'https://play/e2', ...over });

const comment = (over: Partial<EntryComment> = {}): EntryComment => ({
  id: 'cm1',
  author: { name: '하린', user_id: 'u-harin' },
  body: '멋져요',
  created_at: new Date().toISOString(),
  is_mine: false,
  author_withdrawn: false,
  status: 'visible',
  ...over,
});

const entriesPage = (entries: EntryCard[], next_cursor: string | null = null) => ({ entries, next_cursor, ranking_state: null });
const serverError = (status: number, code: string) => new ApiError(status, '서버 오류', code, code);
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const escape = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const endsWith = (label: string) => new RegExp(`${escape(label)}$`);
const startsWith = (label: string) => new RegExp(`^${escape(label)}`);

/**
 * 재생 토글·닫기·메뉴는 이름 없는 아이콘 버튼이다. 참여작 하나짜리 피드에서 소리 버튼을 기준으로 앞뒤 위치로 찾는다
 * (순서: 재생 토글, 닫기, 소리, 메뉴).
 */
function iconButtons() {
  const buttons = screen.getAllByRole('button');
  const mute = buttons.findIndex((b) => /^소리 (끄기|켜기)$/.test(b.props.accessibilityLabel ?? ''));
  return { toggle: buttons[mute - 2], close: buttons[mute - 1], menu: buttons[mute + 1] };
}

async function swipeTo(index: number, anchorText: string) {
  await fireEvent(screen.getAllByText(anchorText)[0], 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { y: HEIGHT * index } },
  });
}

async function renderFeed(entries: EntryCard[] = [entry()], next: string | null = null) {
  mocked.listChallengeEntries.mockResolvedValueOnce(entriesPage(entries, next));
  await render(<ChallengePlayScreen />);
  await screen.findAllByText('“나는 아직 여기 있어”');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'c1' };
  mockFocused = true;
  mockUser = { id: 'me' };
  mockPlayer.muted = false;
  mockPlayer.status = 'readyToPlay';
  mockPlayer.currentTime = 10;
  mockPlayer.replaceAsync.mockResolvedValue(undefined);
  mocked.getChallenge.mockResolvedValue(challenge());
  mocked.listChallengeEntries.mockResolvedValue(entriesPage([entry()]));
  mocked.getEntry.mockRejectedValue(serverError(404, 'entry_not_found'));
  mocked.recordEntryView.mockResolvedValue(undefined);
  mocked.listComments.mockResolvedValue({ comments: [], next_cursor: null });
});

describe('불러오기', () => {
  test('챌린지 id 로 들어오면 좋아요순으로 참여작을 받아 첫 참여작을 틀고 작성자·순서·대사·캡션을 보여 준다', async () => {
    await renderFeed([entry(), second()]);

    expect(mocked.getChallenge).toHaveBeenCalledWith('c1');
    expect(mocked.listChallengeEntries).toHaveBeenCalledWith('c1', { sort: 'likes', fromEntry: undefined });
    expect(mocked.getEntry).not.toHaveBeenCalled();
    expect(screen.getAllByText('민지')).toHaveLength(1);
    expect(screen.getByText('1 / 2')).toBeOnTheScreen();
    expect(screen.getByText('2 / 2')).toBeOnTheScreen();
    expect(screen.getAllByText('빗속의 집')).toHaveLength(2);
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getAllByText('2')).toHaveLength(2);

    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalled());
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith('https://play/e1');
    expect(mockPlayer.loop).toBe(true);
    expect(logged('challenge_swipe')).toEqual([{ index: 0 }]);
    expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeOnTheScreen();
  });

  test('불러오는 동안에도 닫을 수 있다', async () => {
    mocked.getChallenge.mockReturnValue(new Promise(() => undefined));
    await render(<ChallengePlayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('챌린지·참여작 id 가 모두 없으면 아무것도 부르지 않고 닫기만 둔다', async () => {
    mockParams = {};
    await render(<ChallengePlayScreen />);
    expect(screen.getByRole('button', { name: '닫기' })).toBeOnTheScreen();
    expect(mocked.getChallenge).not.toHaveBeenCalled();
    expect(mocked.getEntry).not.toHaveBeenCalled();
  });

  test('참여작 id 만 넘어오면 그 참여작에서 챌린지를 알아내 그 참여작부터 연다', async () => {
    mockParams = { entryId: 'e2' };
    mocked.getEntry.mockResolvedValue(second({ challenge_id: 'c1' }));
    await renderFeed([second(), entry()]);

    expect(mocked.getEntry).toHaveBeenCalledWith('e2');
    expect(mocked.getChallenge).toHaveBeenCalledWith('c1');
    expect(mocked.listChallengeEntries).toHaveBeenCalledWith('c1', { sort: 'likes', fromEntry: 'e2' });
    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenCalledWith('https://play/e2'));
  });

  test('공개 목록에 없는 내 비공개 참여작은 그 참여작 하나만 보여 준다', async () => {
    mockParams = { entryId: 'mine' };
    const own = entry({ id: 'mine', is_mine: true, author: { name: '나', user_id: 'me' }, caption: '비공개 연습' });
    mocked.getEntry.mockResolvedValue(own);
    mocked.listChallengeEntries.mockRejectedValue(serverError(404, 'entry_not_found'));
    await render(<ChallengePlayScreen />);

    expect(await screen.findByText('비공개 연습')).toBeOnTheScreen();
    expect(screen.getByText('1 / 1')).toBeOnTheScreen();
    expect(screen.queryByText('없는 챌린지예요.')).not.toBeOnTheScreen();
  });

  test('참여작을 찾지 못하고 챌린지 id 도 없으면 없는 챌린지라고 알린다', async () => {
    mockParams = { entryId: 'gone' };
    await render(<ChallengePlayScreen />);
    expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
    expect(mocked.getChallenge).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['게스트', serverError(403, 'member_only'), '챌린지는 회원만 이용할 수 있어요.'],
    ['연결 끊김', serverError(503, 'unavailable'), '연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.'],
  ])('챌린지를 못 받으면(%s) 이유와 닫기를 보여 준다', async (_name, error, message) => {
    mocked.getChallenge.mockRejectedValue(error);
    await render(<ChallengePlayScreen />);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '닫기' })).toBeOnTheScreen();
    expect(screen.queryByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.')).not.toBeOnTheScreen();
  });

  test('내 참여작이 있어도 목록 실패가 404 가 아니면 오류로 알린다', async () => {
    mockParams = { entryId: 'mine' };
    mocked.getEntry.mockResolvedValue(entry({ id: 'mine', is_mine: true }));
    mocked.listChallengeEntries.mockRejectedValue(serverError(403, 'member_only'));
    await render(<ChallengePlayScreen />);
    expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
  });

  test('응답이 오기 전에 화면을 닫으면 결과를 버린다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mocked.getChallenge.mockReturnValue(new Promise((r) => (resolve = r)));
    const view = await render(<ChallengePlayScreen />);
    await view.unmount();
    await act(async () => resolve(challenge()));
    expect(mockPlayer.replaceAsync).not.toHaveBeenCalled();

    let reject: (e: unknown) => void = () => undefined;
    mocked.getChallenge.mockReturnValue(new Promise((_r, j) => (reject = j)));
    const again = await render(<ChallengePlayScreen />);
    await again.unmount();
    await act(async () => reject(serverError(403, 'member_only')));
    expect(screen.queryByText('챌린지는 회원만 이용할 수 있어요.')).not.toBeOnTheScreen();
  });
});

describe('참여작이 없을 때', () => {
  test('대사와 첫 참여 안내, 연기하기를 보여 주고 연기하기는 그 대사를 실어 촬영으로 간다', async () => {
    mocked.listChallengeEntries.mockResolvedValue(entriesPage([]));
    await render(<ChallengePlayScreen />);

    expect(await screen.findByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.')).toBeOnTheScreen();
    expect(screen.getByText('“나는 아직 여기 있어”')).toBeOnTheScreen();
    expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: endsWith('나도 이 대사 연기하기') }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'c1', line: '나는 아직 여기 있어', work: '빗속의 집' },
    });
    expect(logged('challenge_perform_tap')).toEqual([{ id: 'c1' }]);

    const buttons = screen.getAllByRole('button');
    await fireEvent.press(buttons[0]);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('종료된 챌린지에는 연기하기가 없다', async () => {
    mocked.getChallenge.mockResolvedValue(challenge({ ends_at: new Date(Date.now() - DAY).toISOString() }));
    mocked.listChallengeEntries.mockResolvedValue(entriesPage([]));
    await render(<ChallengePlayScreen />);
    await screen.findByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.');
    expect(screen.queryByRole('button', { name: endsWith('나도 이 대사 연기하기') })).not.toBeOnTheScreen();
  });
});

describe('재생', () => {
  test('재생 주소가 없는 참여작은 바로 재생할 수 없다고 알린다', async () => {
    await renderFeed([entry({ playback_url: null })]);
    expect(screen.getByText('이 영상을 재생할 수 없어요.')).toBeOnTheScreen();
    expect(mockPlayer.replaceAsync).not.toHaveBeenCalled();
  });

  test('플레이어가 오류를 알리면 안내하고, 다시 준비되면 안내를 걷는다', async () => {
    await renderFeed();
    await act(async () => mockStatusListener({ status: 'error' }));
    expect(screen.getByText('이 영상을 재생할 수 없어요.')).toBeOnTheScreen();
    await act(async () => mockStatusListener({ status: 'loading' }));
    expect(screen.getByText('이 영상을 재생할 수 없어요.')).toBeOnTheScreen();
    await act(async () => mockStatusListener({ status: 'readyToPlay' }));
    expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();
  });

  test('영상을 불러오지 못하면 재생할 수 없다고 알린다', async () => {
    mockPlayer.replaceAsync.mockRejectedValue(new Error('decode'));
    await renderFeed();
    expect(await screen.findByText('이 영상을 재생할 수 없어요.')).toBeOnTheScreen();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  test('15초가 지나도 준비되지 않으면 재생할 수 없다고 알린다', async () => {
    jest.useFakeTimers();
    try {
      mockPlayer.status = 'loading';
      mockPlayer.replaceAsync.mockReturnValue(new Promise(() => undefined));
      await renderFeed();
      await act(async () => jest.advanceTimersByTime(14_000));
      expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(1_000));
      expect(screen.getByText('이 영상을 재생할 수 없어요.')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('15초 안에 준비되면 안내하지 않는다', async () => {
    jest.useFakeTimers();
    try {
      await renderFeed();
      await act(async () => jest.advanceTimersByTime(15_000));
      expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('불러오는 중에 화면을 닫으면 늦게 끝난 불러오기로 틀거나 실패를 알리지 않는다', async () => {
    let resolve: () => void = () => undefined;
    mockPlayer.replaceAsync.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    await renderFeed();
    await screen.unmount();
    await act(async () => resolve());
    expect(mockPlayer.play).not.toHaveBeenCalled();

    let reject: (e: unknown) => void = () => undefined;
    mockPlayer.replaceAsync.mockReturnValueOnce(new Promise<void>((_r, j) => (reject = j)));
    await renderFeed();
    await screen.unmount();
    await act(async () => reject(new Error('late')));
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  test('화면을 누르면 멈추고 다시 누르면 튼다', async () => {
    await renderFeed();
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));

    await fireEvent.press(iconButtons().toggle);
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    await fireEvent.press(iconButtons().toggle);
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  test('소리는 켠 채로 시작하고 스피커 버튼으로 끄고 켠다', async () => {
    await renderFeed();
    expect(mockPlayer.muted).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: '소리 끄기' }));
    expect(mockPlayer.muted).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '소리 켜기' }));
    expect(mockPlayer.muted).toBe(false);
    expect(screen.getByRole('button', { name: '소리 끄기' })).toBeOnTheScreen();
  });

  test('위쪽 닫기 버튼은 이전 화면으로 돌아간다', async () => {
    await renderFeed();
    await fireEvent.press(iconButtons().close);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('다른 화면이 위에 올라오면 영상을 내려놓고, 돌아오면 보던 참여작을 다시 튼다', async () => {
    await renderFeed();
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    await fireEvent.press(iconButtons().toggle);

    mockFocused = false;
    await screen.rerender(<ChallengePlayScreen />);
    expect(mockPlayer.pause).toHaveBeenCalledTimes(2);
    expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith(null);

    mockFocused = true;
    await screen.rerender(<ChallengePlayScreen />);
    expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://play/e1');
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(2));
  });

  test('돌아왔을 때 플레이어가 이미 풀려 있거나 불러오기가 실패해도 화면은 그대로다', async () => {
    await renderFeed();
    mockFocused = false;
    mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('released'));
    await screen.rerender(<ChallengePlayScreen />);

    mockFocused = true;
    mockPlayer.replaceAsync.mockImplementationOnce(() => {
      throw new Error('released');
    });
    await screen.rerender(<ChallengePlayScreen />);
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();

    mockFocused = false;
    await screen.rerender(<ChallengePlayScreen />);
    mockFocused = true;
    mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('late'));
    await screen.rerender(<ChallengePlayScreen />);
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });

  test('재생 주소가 없는 참여작을 보다 돌아오면 다시 불러오지 않는다', async () => {
    await renderFeed([entry({ playback_url: null })]);
    mockFocused = false;
    await screen.rerender(<ChallengePlayScreen />);
    mockFocused = true;
    await screen.rerender(<ChallengePlayScreen />);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith(null);
  });
});

describe('조회수', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('다른 사람의 참여작을 3초 이상 보면 한 번만 보낸다', async () => {
    await renderFeed();
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mocked.recordEntryView).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(3_000));
    expect(mocked.recordEntryView).toHaveBeenCalledTimes(1);
    expect(mocked.recordEntryView).toHaveBeenCalledWith('e1', expect.any(String));
  });

  test('자동 반복으로 처음으로 되감긴 재생은 세지 않는다', async () => {
    mockPlayer.currentTime = 1;
    await renderFeed();
    // 실제 타이머는 3초 경계에 딱 맞춰 돌지 않는다. 몇 ms 늦게 도는 상황을 만든다.
    jest.setSystemTime(Date.now() + 5);
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mocked.recordEntryView).not.toHaveBeenCalled();
  });

  test('본인 참여작은 세지 않는다', async () => {
    await renderFeed([entry({ is_mine: true })]);
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mocked.recordEntryView).not.toHaveBeenCalled();
  });

  test('멈춰 둔 동안은 세지 않는다', async () => {
    await renderFeed();
    await fireEvent.press(iconButtons().toggle);
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mocked.recordEntryView).not.toHaveBeenCalled();
  });

  test('조회수 요청이 실패해도 재생은 그대로다', async () => {
    mocked.recordEntryView.mockRejectedValue(serverError(503, 'unavailable'));
    await renderFeed();
    await act(async () => jest.advanceTimersByTime(4_000));
    expect(mocked.recordEntryView).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('이 영상을 재생할 수 없어요.')).not.toBeOnTheScreen();
  });
});

describe('넘기기', () => {
  test('아래로 넘기면 다음 참여작으로 갈아끼우고, 마지막에서 더 없으면 종료 안내를 보인다', async () => {
    await renderFeed([entry(), second()]);
    await swipeTo(1, '민지');

    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://play/e2'));
    expect(logged('challenge_swipe')).toEqual([{ index: 0 }, { index: 1 }]);
    expect(screen.getByText('마지막 참여작이에요.')).toBeOnTheScreen();
    expect(mocked.listChallengeEntries).toHaveBeenCalledTimes(1);
  });

  test('끝에서 둘째 참여작에서는 아직 종료 안내를 띄우지 않는다', async () => {
    await renderFeed([entry(), second(), entry({ id: 'e3', playback_url: 'https://play/e3' })]);
    await swipeTo(1, '민지');
    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://play/e2'));
    expect(screen.queryByText('마지막 참여작이에요.')).not.toBeOnTheScreen();
    await swipeTo(2, '민지');
    expect(screen.getByText('마지막 참여작이에요.')).toBeOnTheScreen();
  });

  test('같은 자리에서 멈추거나 위로 튕기면 바꾸지 않는다', async () => {
    await renderFeed([entry(), second(), entry({ id: 'e3', playback_url: 'https://play/e3' })]);
    await swipeTo(0, '민지');
    await swipeTo(-1, '민지');
    expect(logged('challenge_swipe')).toEqual([{ index: 0 }]);
    expect(screen.queryByText('마지막 참여작이에요.')).not.toBeOnTheScreen();
  });

  test('끝에 가까워지면 다음 20개를 이어 받고, 받는 동안 다시 부르지 않는다', async () => {
    await renderFeed([entry(), second(), entry({ id: 'e3', author: { name: '하린', user_id: 'u-h' } })], 'cur-1');

    let resolve: (v: unknown) => void = () => undefined;
    mocked.listChallengeEntries.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await swipeTo(1, '민지');
    await swipeTo(2, '민지');
    expect(mocked.listChallengeEntries).toHaveBeenCalledTimes(2);
    expect(mocked.listChallengeEntries).toHaveBeenLastCalledWith('c1', { sort: 'likes', cursor: 'cur-1' });

    await act(async () => resolve(entriesPage([entry({ id: 'e4', author: { name: '도윤', user_id: 'u-d' } })])));
    expect(screen.getByText('도윤')).toBeOnTheScreen();
    expect(screen.getByText('4 / 4')).toBeOnTheScreen();
    expect(screen.queryByText('마지막 참여작이에요.')).not.toBeOnTheScreen();

    await swipeTo(3, '민지');
    expect(screen.getByText('마지막 참여작이에요.')).toBeOnTheScreen();
  });

  test('순위가 바뀌어 커서가 만료되면 처음부터 다시 받는다', async () => {
    await renderFeed([entry(), second()], 'cur-1');
    mocked.listChallengeEntries
      .mockRejectedValueOnce(serverError(410, 'cursor_expired'))
      .mockResolvedValueOnce(entriesPage([entry({ id: 'f1', author: { name: '새얼굴', user_id: 'u-n' } })], 'cur-9'));
    await swipeTo(1, '민지');

    expect(await screen.findByText('새얼굴')).toBeOnTheScreen();
    expect(mocked.listChallengeEntries).toHaveBeenLastCalledWith('c1', { sort: 'likes' });
    expect(screen.queryByText('민지')).not.toBeOnTheScreen();
  });

  test('다시 받기도 실패하거나 다른 오류면 보던 목록을 둔다', async () => {
    await renderFeed([entry(), second()], 'cur-1');
    mocked.listChallengeEntries
      .mockRejectedValueOnce(serverError(410, 'cursor_expired'))
      .mockRejectedValueOnce(serverError(503, 'unavailable'));
    await swipeTo(1, '민지');
    await waitFor(() => expect(mocked.listChallengeEntries).toHaveBeenCalledTimes(3));
    expect(screen.getByText('민지')).toBeOnTheScreen();

    mocked.listChallengeEntries.mockRejectedValueOnce(serverError(503, 'unavailable'));
    await swipeTo(0, '민지');
    await waitFor(() => expect(mocked.listChallengeEntries).toHaveBeenCalledTimes(4));
    expect(screen.getByText('태오')).toBeOnTheScreen();
  });

  test('참여작 id 로만 들어와도 끝에 닿으면 다음 20개를 이어 받는다', async () => {
    mockParams = { entryId: 'e1' };
    mocked.getEntry.mockResolvedValue(entry());
    await renderFeed([entry(), second()], 'cur-1');
    await swipeTo(1, '민지');
    await waitFor(() =>
      expect(mocked.listChallengeEntries).toHaveBeenLastCalledWith('c1', { sort: 'likes', cursor: 'cur-1' }),
    );
  });
});

describe('좋아요·저장', () => {
  test('좋아요는 먼저 수를 올리고 서버 값으로 맞춘다. 다시 누르면 취소한다', async () => {
    await renderFeed();
    let resolve: (v: unknown) => void = () => undefined;
    mocked.likeEntry.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await fireEvent.press(screen.getByRole('button', { name: '좋아요' }));
    expect(screen.getByText('4')).toBeOnTheScreen();
    expect(mocked.likeEntry).toHaveBeenCalledWith('e1', true);

    await fireEvent.press(screen.getByRole('button', { name: '좋아요' }));
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    expect(mocked.likeEntry).toHaveBeenCalledTimes(1);
    expect(mocked.saveEntry).not.toHaveBeenCalled();

    await act(async () => resolve({ liked: true, like_count: 7 }));
    expect(screen.getByText('7')).toBeOnTheScreen();

    mocked.likeEntry.mockResolvedValueOnce({ liked: false, like_count: 6 });
    await fireEvent.press(screen.getByRole('button', { name: '좋아요' }));
    expect(mocked.likeEntry).toHaveBeenLastCalledWith('e1', false);
    expect(await screen.findByText('6')).toBeOnTheScreen();
  });

  test('좋아요가 실패하면 되돌리고 이유를 알린다', async () => {
    mocked.likeEntry.mockRejectedValue(serverError(404, 'entry_not_found'));
    await renderFeed();
    await fireEvent.press(screen.getByRole('button', { name: '좋아요' }));

    expect(await screen.findByText('이 영상은 더 이상 볼 수 없어요.')).toBeOnTheScreen();
    expect(screen.getAllByText('좋아요')).toHaveLength(1);
    expect(screen.getByText('3')).toBeOnTheScreen();
  });

  test('저장은 바꿔 보이고 서버 값으로 맞추며, 실패하면 되돌리고 알린다. 다른 참여작은 건드리지 않는다', async () => {
    await renderFeed([entry(), second()]);
    const saveFirst = () => screen.getAllByRole('button', { name: '저장' })[0];
    mocked.saveEntry.mockResolvedValueOnce({ saved: true });
    await fireEvent.press(saveFirst());
    expect(mocked.saveEntry).toHaveBeenCalledWith('e1', true);

    mocked.saveEntry.mockRejectedValueOnce(serverError(422, 'self_save'));
    await fireEvent.press(saveFirst());
    expect(mocked.saveEntry).toHaveBeenLastCalledWith('e1', false);
    expect(await screen.findByText('내 참여작에는 누를 수 없어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('확인'));

    mocked.saveEntry.mockResolvedValueOnce({ saved: false });
    await fireEvent.press(saveFirst());
    expect(mocked.saveEntry).toHaveBeenLastCalledWith('e1', false);

    mocked.saveEntry.mockResolvedValueOnce({ saved: true });
    await fireEvent.press(screen.getAllByRole('button', { name: '저장' })[1]);
    expect(mocked.saveEntry).toHaveBeenLastCalledWith('e2', true);
  });

  test('내 참여작에는 좋아요·저장 버튼이 꺼져 있다', async () => {
    await renderFeed([entry({ is_mine: true, author: { name: '나', user_id: 'me' } })]);
    expect(screen.getByRole('button', { name: '좋아요' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: '좋아요' }));
    expect(mocked.likeEntry).not.toHaveBeenCalled();
  });
});

describe('댓글', () => {
  test('댓글을 열어 쓰거나 지우면 아래 댓글 수가 바로 바뀐다', async () => {
    mocked.listComments.mockResolvedValue({ comments: [comment({ id: 'mine-c', is_mine: true, author: { name: '나', user_id: 'me' } })], next_cursor: null });
    mocked.createComment.mockResolvedValue(comment({ id: 'new-c', is_mine: true, body: '잘 봤어요' }));
    mocked.deleteComment.mockResolvedValue(undefined);
    await renderFeed([entry({ comment_count: 5 })]);

    await fireEvent.press(screen.getByRole('button', { name: '댓글' }));
    expect(await screen.findByText('댓글 1')).toBeOnTheScreen();
    expect(mocked.listComments).toHaveBeenCalledWith('e1');

    await fireEvent.changeText(screen.getByPlaceholderText('응원 댓글을 남겨보세요'), '잘 봤어요');
    await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('댓글 2')).toBeOnTheScreen();
    expect(screen.getByText('6')).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: '삭제' })[0]);
    expect(await screen.findByText('댓글 1')).toBeOnTheScreen();
    expect(screen.getByText('5')).toBeOnTheScreen();
  });

  test('남의 댓글을 신고하면 댓글 창을 닫고 댓글 신고로 접수한다', async () => {
    mocked.listComments.mockResolvedValue({ comments: [comment()], next_cursor: null });
    mocked.createReport.mockResolvedValue({ id: 'r1', status: 'received' });
    await renderFeed();

    await fireEvent.press(screen.getByRole('button', { name: '댓글' }));
    await fireEvent.press(await screen.findByRole('button', { name: '신고' }));
    expect(screen.queryByText('댓글 1')).not.toBeOnTheScreen();
    expect(screen.getByText('이 댓글을 신고할까요?')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: startsWith('스팸·중복 업로드') }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

    expect(await screen.findByText('신고를 접수했어요')).toBeOnTheScreen();
    expect(mocked.createReport).toHaveBeenCalledWith({
      request_id: expect.any(String),
      target_type: 'comment',
      target_id: 'cm1',
      reason: 'spam',
    });
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });

  test('댓글 창 바깥을 누르면 닫힌다', async () => {
    await renderFeed();
    await fireEvent.press(screen.getByRole('button', { name: '댓글' }));
    expect(await screen.findByText('아직 댓글이 없어요')).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button');
    await fireEvent.press(buttons[buttons.indexOf(screen.getByRole('button', { name: '보내기' })) - 1]);
    expect(screen.queryByText('아직 댓글이 없어요')).not.toBeOnTheScreen();
  });
});

describe('공유', () => {
  test('공유 아이콘은 공유 시트를 연다. 공개된 남의 참여작은 링크 대상만 있고, 카카오톡은 딥링크 문장을 보낸다', async () => {
    mockSystemShare.mockResolvedValue(undefined);
    await renderFeed([entry({ id: 'e 1' })]);
    await fireEvent.press(screen.getByRole('button', { name: '공유' }));

    expect(await screen.findByText('내 연기 공유하기')).toBeOnTheScreen();
    expect(logged('challenge_share')).toEqual([{ id: 'e 1' }]);
    expect(screen.queryByText('인스타')).not.toBeOnTheScreen();
    expect(screen.queryByText('영상으로 저장')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '카카오톡' }));
    expect(mockSystemShare).toHaveBeenCalledWith(
      '민지의 “나는 아직 여기 있어” 연기 — acttub 챌린지\nhttps://acttub.com/e/e%201',
    );
  });

  test('내 참여작은 인스타 스토리와 영상 저장이 함께 보인다', async () => {
    await renderFeed([entry({ is_mine: true, author: { name: '나', user_id: 'me' } })]);
    await fireEvent.press(screen.getByRole('button', { name: '공유' }));
    expect(await screen.findByText('인스타')).toBeOnTheScreen();
    expect(screen.getByText('영상으로 저장')).toBeOnTheScreen();
  });

  test('공유할 길이 없는 참여작은 시트 대신 안내한다', async () => {
    await renderFeed([entry({ published_at: null })]);
    await fireEvent.press(screen.getByRole('button', { name: '공유' }));
    expect(await screen.findByText('지금은 공유할 수 없는 참여작이에요.')).toBeOnTheScreen();
    expect(screen.queryByText('영상으로 저장')).not.toBeOnTheScreen();
  });
});

describe('반응 메뉴', () => {
  async function openMenu() {
    await fireEvent.press(iconButtons().menu);
  }

  test('작성자 이름 아래 공유·신고·대사 신고·차단을 둔다. 공유는 같은 공유를 연다', async () => {
    await renderFeed();
    await openMenu();

    expect(screen.getAllByText('민지')).toHaveLength(2);
    expect(screen.getByText('이 대사 신고')).toBeOnTheScreen();
    expect(screen.getByText('이 사용자 차단')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByText('공유')[0]);
    expect(await screen.findByText('내 연기 공유하기')).toBeOnTheScreen();
  });

  test('내 참여작 메뉴에는 차단이 없다', async () => {
    await renderFeed([entry({ is_mine: true, author: { name: '나', user_id: 'me' } })]);
    await openMenu();
    expect(screen.getByText('이 대사 신고')).toBeOnTheScreen();
    expect(screen.queryByText('이 사용자 차단')).not.toBeOnTheScreen();
  });

  test('작성자 id 가 없는 참여작(탈퇴 등)은 차단할 수 없다', async () => {
    await renderFeed([entry({ author: { name: '탈퇴', user_id: null as unknown as string } })]);
    await openMenu();
    expect(screen.queryByText('이 사용자 차단')).not.toBeOnTheScreen();
  });

  test('참여작을 신고하면 접수 안내를 보이고 그 참여작을 피드에서 바로 뺀다', async () => {
    mocked.createReport.mockResolvedValue({ id: 'r1', status: 'received' });
    await renderFeed([entry(), second()]);
    await fireEvent.press(iconButtonsAt(0).menu);
    await fireEvent.press(screen.getByText('신고'));

    expect(screen.getByText('이 영상을 신고할까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: startsWith('기타') }));
    expect(screen.getByText('무엇이 문제인지 알려 주세요 (선택)')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByDisplayValue(''), '  출처가 의심돼요 ');
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

    expect(await screen.findByText('운영 확인 전까지 이 영상은 숨겨져요.')).toBeOnTheScreen();
    expect(mocked.createReport).toHaveBeenCalledWith({
      request_id: expect.any(String),
      target_type: 'entry',
      target_id: 'e1',
      reason: 'other',
      note: '출처가 의심돼요',
    });
    expect(logged('challenge_report')).toEqual([{ reason: 'other', target: 'entry' }]);
    expect(screen.queryByText('첫 테이크')).not.toBeOnTheScreen();
    expect(screen.getByText('1 / 1')).toBeOnTheScreen();
  });

  test('대사를 신고하면 운영이 본다고 알리고 참여작은 그대로 둔다', async () => {
    mocked.createReport.mockResolvedValue({ id: 'r1', status: 'received' });
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('이 대사 신고'));

    expect(screen.getByText('이 대사를 신고할까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: startsWith('저작권 침해 — 대사·영상 출처 문제') }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

    expect(await screen.findByText('신고를 접수했어요. 운영이 확인할게요.')).toBeOnTheScreen();
    expect(mocked.createReport).toHaveBeenCalledWith({
      request_id: expect.any(String),
      target_type: 'challenge',
      target_id: 'c1',
      reason: 'copyright',
    });
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });

  test('신고가 실패하면 이유를 알리고 참여작은 남긴다', async () => {
    mocked.createReport.mockRejectedValue(serverError(429, 'daily_report_limit'));
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('신고'));
    await fireEvent.press(screen.getByRole('radio', { name: startsWith('부적절한 콘텐츠') }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));

    expect(await screen.findByText('신고는 하루 20건까지 할 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByText('이 영상을 신고할까요?')).toBeOnTheScreen();
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });

  test('신고 창을 취소하면 아무것도 보내지 않는다', async () => {
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('신고'));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('이 영상을 신고할까요?')).not.toBeOnTheScreen();
    expect(mocked.createReport).not.toHaveBeenCalled();
  });

  test('차단을 확인하면 그 사람의 참여작이 바로 사라지고 설정에서 풀 수 있다고 알린다', async () => {
    mocked.blockUser.mockResolvedValue(undefined);
    await renderFeed([entry(), second(), entry({ id: 'e3', caption: '민지 두 번째' })]);
    await fireEvent.press(iconButtonsAt(0).menu);
    await fireEvent.press(screen.getByText('이 사용자 차단'));

    expect(screen.getByText('이 사람의 참여작과 댓글이 내 화면에서 사라져요. 상대에게는 알리지 않아요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('차단하기'));

    expect(await screen.findByText('차단했어요. 설정에서 풀 수 있어요.')).toBeOnTheScreen();
    expect(mocked.blockUser).toHaveBeenCalledWith('u-minji', true);
    expect(screen.queryByText('민지')).not.toBeOnTheScreen();
    expect(screen.queryByText('민지 두 번째')).not.toBeOnTheScreen();
    expect(screen.getByText('태오')).toBeOnTheScreen();
    expect(screen.getByText('1 / 1')).toBeOnTheScreen();
  });

  test('로그인 정보를 아직 못 읽었어도 남의 참여작은 차단할 수 있다', async () => {
    mockUser = null;
    mocked.blockUser.mockResolvedValue(undefined);
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('이 사용자 차단'));
    await fireEvent.press(screen.getByText('차단하기'));
    expect(await screen.findByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.')).toBeOnTheScreen();
    expect(mocked.blockUser).toHaveBeenCalledWith('u-minji', true);
  });

  test('보던 마지막 참여작을 신고해 빼면 남은 참여작을 튼다', async () => {
    mocked.createReport.mockResolvedValue({ id: 'r1', status: 'received' });
    await renderFeed([entry(), second()]);
    await swipeTo(1, '민지');
    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://play/e2'));

    await fireEvent.press(iconButtonsAt(1).menu);
    await fireEvent.press(screen.getByText('신고'));
    await fireEvent.press(screen.getByRole('radio', { name: startsWith('스팸·중복 업로드') }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
    expect(await screen.findByText('1 / 1')).toBeOnTheScreen();

    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://play/e1'));
  });

  test('차단 확인을 취소하면 아무것도 하지 않는다', async () => {
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('이 사용자 차단'));
    await fireEvent.press(screen.getByText('취소'));
    expect(mocked.blockUser).not.toHaveBeenCalled();
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });

  test('차단이 실패하면 이유를 알리고 참여작은 남긴다', async () => {
    mocked.blockUser.mockRejectedValue(serverError(404, 'user_not_found'));
    await renderFeed();
    await openMenu();
    await fireEvent.press(screen.getByText('이 사용자 차단'));
    await fireEvent.press(screen.getByText('차단하기'));

    expect(await screen.findByText('없는 사용자예요.')).toBeOnTheScreen();
    expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  });
});

describe('연기하기', () => {
  test('피드에서 연기하기를 누르면 그 대사를 실어 촬영으로 간다', async () => {
    await renderFeed();
    await fireEvent.press(screen.getByRole('button', { name: endsWith('나도 이 대사 연기하기') }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'c1', line: '나는 아직 여기 있어', work: '빗속의 집' },
    });
  });

  test('보는 사이 마감이 지나면 눌러도 촬영으로 가지 않는다', async () => {
    jest.useFakeTimers();
    try {
      mocked.getChallenge.mockResolvedValue(challenge({ ends_at: new Date(Date.now() + 60_000).toISOString() }));
      await renderFeed();
      jest.setSystemTime(Date.now() + 120_000);
      await fireEvent.press(screen.getByRole('button', { name: endsWith('나도 이 대사 연기하기') }));
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(logged('challenge_perform_tap')).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('종료된 챌린지 피드에는 연기하기가 없다', async () => {
    mocked.getChallenge.mockResolvedValue(challenge({ ends_at: new Date(Date.now() - DAY).toISOString() }));
    await renderFeed();
    expect(screen.queryByRole('button', { name: endsWith('나도 이 대사 연기하기') })).not.toBeOnTheScreen();
  });
});

/** 참여작이 여럿일 때 index 번째 페이지의 아이콘 버튼. */
function iconButtonsAt(index: number) {
  const buttons = screen.getAllByRole('button');
  const mutes = buttons
    .map((b, i) => (/^소리 (끄기|켜기)$/.test(b.props.accessibilityLabel ?? '') ? i : -1))
    .filter((i) => i >= 0);
  const mute = mutes[index];
  return { toggle: buttons[mute - 2], close: buttons[mute - 1], menu: buttons[mute + 1] };
}
