import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ArchiveScreen from '@/app/archive';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onLibraryChange, pendingLibraryUploads, takeDiscardedCount } from '@/lib/library/library-runner';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { libraryVideo, queuedVideo } from '../helpers/library-video';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: { pick?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('@/lib/api', () => ({ api: { listVideos: jest.fn(), setVideoFavorite: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/picked-video', () => ({ setPickedVideo: jest.fn() }));
jest.mock('@/lib/library/library-runner', () => ({
  onLibraryChange: jest.fn(),
  pendingLibraryUploads: jest.fn(),
  takeDiscardedCount: jest.fn(),
}));

const listVideos = api.listVideos as jest.Mock;
const setFavorite = api.setVideoFavorite as jest.Mock;
let libraryListener: (() => void) | null = null;

const used = libraryVideo({ id: 'v1', usage: { practice_count: 2, entry_count: 1 }, poster_url: 'https://cdn/p1.jpg?sig=1' });
const unused = libraryVideo({ id: 'v2', favorite: true, duration_ms: 5_000, created_at: new Date(Date.now() - 60_000).toISOString() });
const purged = libraryVideo({ id: 'v3', duration_ms: 30_000, purged_at: '2026-01-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z' });
const pendingEntry = queuedVideo({ id: 'q1', durationMs: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  (useAuth as jest.Mock).mockReturnValue({ user: { id: 'u1' } });
  listVideos.mockResolvedValue({ videos: [used, unused, purged], next_cursor: null });
  (pendingLibraryUploads as jest.Mock).mockResolvedValue([pendingEntry]);
  (takeDiscardedCount as jest.Mock).mockReturnValue(0);
  (onLibraryChange as jest.Mock).mockImplementation((fn: () => void) => {
    libraryListener = fn;
    return () => undefined;
  });
});

const cell = (caption: string | RegExp) => screen.getByRole('button', { name: caption instanceof RegExp ? caption : new RegExp(caption) });

test('업로드 대기를 맨 위에 두고 영상마다 쓰인 곳을 보여 준다', async () => {
  await render(<ArchiveScreen />);

  expect(await screen.findByText('연습 2회 · 챌린지 1개')).toBeOnTheScreen();
  expect(listVideos).toHaveBeenCalledWith('all');
  expect(pendingLibraryUploads).toHaveBeenCalledWith('u1');
  expect(screen.getByText('보관함')).toBeOnTheScreen();
  expect(screen.getByText('촬영으로 저장한 영상 4개 · 좋은 컷만 골라 두세요 · 업로드 대기 1개')).toBeOnTheScreen();
  expect(screen.getAllByText(/^(기기에 저장 · 업로드 대기|연습 2회 · 챌린지 1개|아직 안 쓴 영상|재생할 수 없어요)$/).map((n) => n.props.children)).toEqual([
    '기기에 저장 · 업로드 대기',
    '연습 2회 · 챌린지 1개',
    '아직 안 쓴 영상',
    '재생할 수 없어요',
  ]);
  expect(screen.getByText('1:05')).toBeOnTheScreen();
  expect(screen.getByText('0:05')).toBeOnTheScreen();
});

test('영상이나 대기 항목을 누르면 상세로 간다', async () => {
  await render(<ArchiveScreen />);

  await fireEvent.press(await screen.findByText('연습 2회 · 챌린지 1개'));
  expect(logEvent).toHaveBeenCalledWith('archive_open', { id: 'v1', kind: 'video' });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/archive-detail', params: { id: 'v1' } });

  await fireEvent.press(screen.getByText('기기에 저장 · 업로드 대기'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/archive-detail', params: { pending: 'q1' } });
});

describe('고르는 화면으로 열면', () => {
  beforeEach(() => {
    mockParams = { pick: '1' };
  });

  test('고른 영상을 넘기고 돌아간다', async () => {
    await render(<ArchiveScreen />);
    expect(await screen.findByText('보관함에서 고르기')).toBeOnTheScreen();

    await fireEvent.press(await screen.findByText('아직 안 쓴 영상'));

    expect(setPickedVideo).toHaveBeenCalledWith({ videoId: 'v2', pendingId: null, uri: null, playbackUrl: null, durationMs: 5_000 });
    expect(logEvent).toHaveBeenCalledWith('archive_pick', { id: 'v2', kind: 'video' });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('대기 중인 촬영본도 고를 수 있다', async () => {
    await render(<ArchiveScreen />);
    await fireEvent.press(await screen.findByText('기기에 저장 · 업로드 대기'));

    expect(setPickedVideo).toHaveBeenCalledWith({ videoId: null, pendingId: 'q1', uri: 'file:///q1.mp4', playbackUrl: null, durationMs: null });
  });

  test('파일을 파기한 영상은 고르지 않고 재생할 수 없다고 알린다', async () => {
    await render(<ArchiveScreen />);
    await fireEvent.press(await screen.findByText('재생할 수 없어요'));

    expect(setPickedVideo).not.toHaveBeenCalled();
    expect(screen.getAllByText('재생할 수 없어요')).toHaveLength(2);
    await fireEvent.press(screen.getAllByText('재생할 수 없어요')[0]);
    expect(screen.getAllByText('재생할 수 없어요')).toHaveLength(1);
  });
});

test('즐겨찾기 필터는 즐겨찾기한 영상만 보여 준다', async () => {
  await render(<ArchiveScreen />);
  await screen.findByText('연습 2회 · 챌린지 1개');

  await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));

  expect(listVideos).toHaveBeenLastCalledWith('favorite');
  expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();
  expect(screen.queryByText('연습 2회 · 챌린지 1개')).not.toBeOnTheScreen();
  expect(screen.queryByText('기기에 저장 · 업로드 대기')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '즐겨찾기' })).toBeSelected();
});

test('이번 주 필터는 7일 안의 것만 보여 준다', async () => {
  await render(<ArchiveScreen />);
  await screen.findByText('연습 2회 · 챌린지 1개');

  await fireEvent.press(screen.getByRole('button', { name: '이번 주' }));

  expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();
  expect(listVideos).toHaveBeenLastCalledWith('recent7');
  expect(screen.queryByText('재생할 수 없어요')).not.toBeOnTheScreen();
});

describe('별표', () => {
  const pressStar = async (caption: string) => {
    const buttons = screen.getAllByRole('button');
    await fireEvent.press(buttons[buttons.indexOf(cell(caption)) + 1]);
  };

  test('누르면 바로 바꾸고 서버에 보내며, 다시 누르면 되돌린다', async () => {
    setFavorite.mockResolvedValue(undefined);
    await render(<ArchiveScreen />);
    await screen.findByText('연습 2회 · 챌린지 1개');

    await pressStar('연습 2회 · 챌린지 1개');
    await pressStar('연습 2회 · 챌린지 1개');

    expect(setFavorite.mock.calls).toEqual([
      ['v1', true],
      ['v1', false],
    ]);
    expect(listVideos).toHaveBeenCalledTimes(1);
  });

  test('실패하면 다시 읽어 되돌린다', async () => {
    setFavorite.mockRejectedValue(new Error('down'));
    await render(<ArchiveScreen />);
    await screen.findByText('연습 2회 · 챌린지 1개');

    await pressStar('아직 안 쓴 영상');
    expect(setFavorite).toHaveBeenCalledWith('v2', false);
    await waitFor(() => expect(listVideos).toHaveBeenCalledTimes(2));
  });
});

test('못 불러오면 다시 시도를 둔다', async () => {
  listVideos.mockRejectedValueOnce(new Error('down'));
  await render(<ArchiveScreen />);

  expect(await screen.findByText('보관함을 불러오지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));

  expect(await screen.findByText('연습 2회 · 챌린지 1개')).toBeOnTheScreen();
  expect(screen.queryByText('보관함을 불러오지 못했어요')).not.toBeOnTheScreen();
});

test('아무것도 없으면 빈 안내를 보인다', async () => {
  listVideos.mockResolvedValue({ videos: [], next_cursor: null });
  (pendingLibraryUploads as jest.Mock).mockResolvedValue([]);
  await render(<ArchiveScreen />);

  expect(await screen.findByText('아직 보관한 영상이 없어요')).toBeOnTheScreen();
  expect(screen.getByText('촬영으로 저장한 영상 0개 · 좋은 컷만 골라 두세요')).toBeOnTheScreen();
});

test('로그인 전이면 기기 대기 목록을 읽지 않는다', async () => {
  (useAuth as jest.Mock).mockReturnValue({ user: null });
  await render(<ArchiveScreen />);

  expect(await screen.findByText('연습 2회 · 챌린지 1개')).toBeOnTheScreen();
  expect(pendingLibraryUploads).not.toHaveBeenCalled();
  expect(screen.queryByText('기기에 저장 · 업로드 대기')).not.toBeOnTheScreen();
});

test('7일이 지나 버린 촬영본 수를 알리고, 누르면 닫는다', async () => {
  (takeDiscardedCount as jest.Mock).mockReturnValue(2);
  await render(<ArchiveScreen />);

  await fireEvent.press(await screen.findByText('7일이 지나 올리지 못한 영상 2개를 지웠어요.'));
  expect(screen.queryByText('7일이 지나 올리지 못한 영상 2개를 지웠어요.')).not.toBeOnTheScreen();
});

test('보관함이 바뀌면 다시 읽는다', async () => {
  await render(<ArchiveScreen />);
  await screen.findByText('연습 2회 · 챌린지 1개');
  listVideos.mockResolvedValue({ videos: [unused], next_cursor: null });

  await act(async () => libraryListener?.());

  expect(screen.queryByText('연습 2회 · 챌린지 1개')).not.toBeOnTheScreen();
  expect(screen.getByText('아직 안 쓴 영상')).toBeOnTheScreen();
});

describe('영상 더 보기', () => {
  test('다음 쪽을 겹치지 않게 붙인다', async () => {
    listVideos
      .mockResolvedValueOnce({ videos: [used], next_cursor: 'cur-2' })
      .mockResolvedValueOnce({ videos: [used, unused], next_cursor: null });
    await render(<ArchiveScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '영상 더 보기' }));

    expect(listVideos).toHaveBeenLastCalledWith('all', 'cur-2');
    expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();
    expect(screen.getAllByText('연습 2회 · 챌린지 1개')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '영상 더 보기' })).not.toBeOnTheScreen();
  });

  test('받는 동안은 불러오는 중이고, 실패하면 다시 시도를 둔다', async () => {
    let fail!: (e: unknown) => void;
    listVideos
      .mockResolvedValueOnce({ videos: [used], next_cursor: 'cur-2' })
      .mockReturnValueOnce(new Promise((_, j) => (fail = j)));
    await render(<ArchiveScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '영상 더 보기' }));
    expect(screen.getByRole('button', { name: '불러오는 중…' })).toBeDisabled();

    await act(async () => fail(new Error('down')));
    expect(screen.getByText('보관함을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '영상 더 보기' })).toBeEnabled();
  });

  test('받는 사이 필터를 바꾸면 늦게 온 쪽을 버린다', async () => {
    let resolveMore!: (v: unknown) => void;
    listVideos
      .mockResolvedValueOnce({ videos: [used], next_cursor: 'cur-2' })
      .mockReturnValueOnce(new Promise((r) => (resolveMore = r)))
      .mockResolvedValueOnce({ videos: [unused], next_cursor: null });
    await render(<ArchiveScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '영상 더 보기' }));
    await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));
    expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();

    await act(async () => resolveMore({ videos: [purged], next_cursor: 'cur-3' }));
    expect(screen.queryByText('재생할 수 없어요')).not.toBeOnTheScreen();
  });

  test('받는 사이 필터를 바꾸면 늦게 온 실패도 버린다', async () => {
    let failMore!: (e: unknown) => void;
    listVideos
      .mockResolvedValueOnce({ videos: [used], next_cursor: 'cur-2' })
      .mockReturnValueOnce(new Promise((_, j) => (failMore = j)))
      .mockResolvedValueOnce({ videos: [unused], next_cursor: null });
    await render(<ArchiveScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '영상 더 보기' }));
    await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));
    expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();

    await act(async () => failMore(new Error('late')));
    expect(screen.queryByText('보관함을 불러오지 못했어요')).not.toBeOnTheScreen();
  });
});

test('필터를 바꾼 뒤 늦게 온 이전 목록과 실패는 버린다', async () => {
  let resolveOld!: (v: unknown) => void;
  let rejectOlder!: (e: unknown) => void;
  listVideos
    .mockReturnValueOnce(new Promise((_, j) => (rejectOlder = j)))
    .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
    .mockResolvedValueOnce({ videos: [unused], next_cursor: null });
  await render(<ArchiveScreen />);

  await fireEvent.press(screen.getByRole('button', { name: '이번 주' }));
  await fireEvent.press(screen.getByRole('button', { name: '즐겨찾기' }));
  expect(await screen.findByText('아직 안 쓴 영상')).toBeOnTheScreen();

  await act(async () => {
    rejectOlder(new Error('late'));
    resolveOld({ videos: [used], next_cursor: null });
  });
  expect(screen.queryByText('보관함을 불러오지 못했어요')).not.toBeOnTheScreen();
  expect(screen.queryByText('연습 2회 · 챌린지 1개')).not.toBeOnTheScreen();
});

test('뒤로는 이전 화면으로 간다', async () => {
  await render(<ArchiveScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  await screen.findByText('연습 2회 · 챌린지 1개');
});
