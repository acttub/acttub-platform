import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ArchiveDetailScreen from '@/app/archive-detail';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { useAuth } from '@/lib/auth';
import {
  flushLibraryUploads,
  forgetLocalCopy,
  localCopyFor,
  onLibraryChange,
  pendingLibraryUploads,
  removePendingUpload,
} from '@/lib/library/library-runner';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { libraryVideo, queuedVideo } from '../helpers/library-video';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: { id?: string; pending?: string } = {};
const mockPlayer = { play: jest.fn(), pause: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-video', () => {
  const { Text } = require('react-native');
  return {
    useVideoPlayer: (_src: unknown, setup?: (p: object) => void) => {
      setup?.(mockPlayer);
      return mockPlayer;
    },
    VideoView: () => <Text>영상 화면</Text>,
  };
});
jest.mock('@/hooks/use-video-preview-events', () => ({ useVideoPreviewEvents: () => undefined }));
jest.mock('@/lib/api', () => ({
  api: { getVideo: jest.fn(), setVideoFavorite: jest.fn(), purgeVideoFile: jest.fn(), deleteVideo: jest.fn() },
}));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/practice/picked-video', () => ({ setPickedVideo: jest.fn() }));
jest.mock('@/lib/library/library-runner', () => ({
  flushLibraryUploads: jest.fn(),
  forgetLocalCopy: jest.fn(),
  localCopyFor: jest.fn(),
  onLibraryChange: jest.fn(),
  pendingLibraryUploads: jest.fn(),
  removePendingUpload: jest.fn(),
}));

const getVideo = api.getVideo as jest.Mock;
const setFavorite = api.setVideoFavorite as jest.Mock;
const purgeFile = api.purgeVideoFile as jest.Mock;
const deleteVideo = api.deleteVideo as jest.Mock;
let libraryListener: (() => void) | null = null;

const FUTURE = '2099-01-01T00:00:00Z';
const fresh = libraryVideo({ id: 'v1', playback_url: 'https://cdn/v1.mp4?sig', playback_expires_at: FUTURE });
const inUse = libraryVideo({ ...fresh, usage: { practice_count: 2, entry_count: 1 } });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'v1' };
  (useAuth as jest.Mock).mockReturnValue({ user: { id: 'u1' } });
  getVideo.mockResolvedValue(fresh);
  (localCopyFor as jest.Mock).mockResolvedValue(null);
  (forgetLocalCopy as jest.Mock).mockResolvedValue(undefined);
  (removePendingUpload as jest.Mock).mockResolvedValue(undefined);
  (onLibraryChange as jest.Mock).mockImplementation((fn: () => void) => {
    libraryListener = fn;
    return () => undefined;
  });
});

function topButtons() {
  const buttons = screen.getAllByRole('button');
  const back = buttons.indexOf(screen.getByRole('button', { name: '뒤로' }));
  return { play: back > 0 ? buttons[0] : null, star: buttons[back + 1], trash: buttons[back + 2] };
}

async function confirmLast(label: string) {
  const labels = await screen.findAllByText(label);
  await fireEvent.press(labels[labels.length - 1]);
}

describe('보관함 영상', () => {
  test('저장 상태·길이·사용처를 보여 준다', async () => {
    getVideo.mockResolvedValue(inUse);
    await render(<ArchiveDetailScreen />);

    expect(await screen.findByText('사용처 · 회차 2개 · 챌린지 참여작 1개')).toBeOnTheScreen();
    expect(getVideo).toHaveBeenCalledWith('v1');
    expect(localCopyFor).toHaveBeenCalledWith('v1');
    expect(screen.getByText(/^오늘 .+ · 1:05 · 보관함 저장$/)).toBeOnTheScreen();
    expect(screen.getByText('영상 화면')).toBeOnTheScreen();
  });

  test('누르면 재생하고 다시 누르면 멈춘다', async () => {
    await render(<ArchiveDetailScreen />);
    await screen.findByText('영상 화면');

    await fireEvent.press(topButtons().play!);
    await fireEvent.press(topButtons().play!);

    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  });

  test('재생 주소가 만료됐으면 틀지 않고 새 주소를 받는다', async () => {
    getVideo.mockResolvedValue({ ...fresh, playback_expires_at: '2020-01-01T00:00:00Z' });
    await render(<ArchiveDetailScreen />);
    await screen.findByText('영상 화면');

    await fireEvent.press(topButtons().play!);

    expect(getVideo).toHaveBeenCalledTimes(2);
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  test.each([
    ['만료 시각이 없으면', null],
    ['만료 시각을 읽을 수 없으면', 'not-a-date'],
  ])('%s 그대로 튼다', async (_name, expiresAt) => {
    getVideo.mockResolvedValue({ ...fresh, playback_expires_at: expiresAt });
    await render(<ArchiveDetailScreen />);
    await screen.findByText('영상 화면');

    await fireEvent.press(topButtons().play!);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(getVideo).toHaveBeenCalledTimes(1);
  });

  test('재생 주소가 아직 없는 영상도 코칭으로 보낸다', async () => {
    (localCopyFor as jest.Mock).mockResolvedValue('file:///copy.mp4');
    getVideo.mockResolvedValue({ ...fresh, playback_url: null, playback_expires_at: null });
    await render(<ArchiveDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /질문 코칭으로 보내기/ }));

    expect(setPickedVideo).toHaveBeenCalledWith({
      videoId: 'v1',
      pendingId: null,
      uri: 'file:///copy.mp4',
      playbackUrl: null,
      durationMs: 65_000,
    });
  });

  test('기기 복사본이 있으면 만료와 상관없이 그걸 튼다', async () => {
    (localCopyFor as jest.Mock).mockResolvedValue('file:///copy.mp4');
    getVideo.mockResolvedValue({ ...fresh, playback_expires_at: '2020-01-01T00:00:00Z' });
    await render(<ArchiveDetailScreen />);
    await screen.findByText('영상 화면');

    await fireEvent.press(topButtons().play!);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(getVideo).toHaveBeenCalledTimes(1);
  });

  test('질문 코칭으로 보내면 보관함 영상 id로 새 연습을 연다', async () => {
    await render(<ArchiveDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /질문 코칭으로 보내기/ }));

    expect(logEvent).toHaveBeenCalledWith('archive_to_coach', { id: 'v1' });
    expect(setPickedVideo).toHaveBeenCalledWith({
      videoId: 'v1',
      pendingId: null,
      uri: null,
      playbackUrl: 'https://cdn/v1.mp4?sig',
      durationMs: 65_000,
    });
    expect(mockRouter.push).toHaveBeenCalledWith('/upload');
  });

  test('챌린지에 올리기는 대사를 고르러 간다', async () => {
    await render(<ArchiveDetailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /챌린지에 올리기/ }));

    expect(logEvent).toHaveBeenCalledWith('archive_to_challenge', { id: 'v1' });
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenges', params: { pickVideoId: 'v1' } });
  });

  test('파일을 파기한 영상은 재생도, 코칭·챌린지로 보내기도 안 된다고 알린다', async () => {
    getVideo.mockResolvedValue({ ...fresh, purged_at: '2026-01-01T00:00:00Z' });
    await render(<ArchiveDetailScreen />);

    expect(await screen.findByText(/· 재생할 수 없어요$/)).toBeOnTheScreen();
    expect(screen.queryByText('영상 화면')).not.toBeOnTheScreen();
    expect(topButtons().play).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: /질문 코칭으로 보내기/ }));
    expect(await screen.findAllByText('재생할 수 없어요')).toHaveLength(2);
    await fireEvent.press(screen.getByText('확인'));
    await fireEvent.press(screen.getByRole('button', { name: /챌린지에 올리기/ }));
    expect(await screen.findAllByText('재생할 수 없어요')).toHaveLength(2);
    expect(setPickedVideo).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('별표는 바로 바꾸고, 실패하면 다시 읽는다', async () => {
    setFavorite.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('down'));
    await render(<ArchiveDetailScreen />);
    await screen.findByText('영상 화면');

    await fireEvent.press(topButtons().star);
    await fireEvent.press(topButtons().star);

    expect(setFavorite.mock.calls).toEqual([
      ['v1', true],
      ['v1', false],
    ]);
    await waitFor(() => expect(getVideo).toHaveBeenCalledTimes(2));
  });

  describe('삭제', () => {
    test('쓰인 곳이 없으면 확인 뒤 지우고 기기 복사본도 잊는다', async () => {
      deleteVideo.mockResolvedValue(undefined);
      await render(<ArchiveDetailScreen />);
      await screen.findByText('영상 화면');

      await fireEvent.press(topButtons().trash);
      expect(await screen.findByText('보관함에서 지우면 되돌릴 수 없어요.')).toBeOnTheScreen();
      await confirmLast('삭제');

      expect(logEvent).toHaveBeenCalledWith('archive_delete', { id: 'v1' });
      expect(deleteVideo).toHaveBeenCalledWith('v1');
      expect(forgetLocalCopy).toHaveBeenCalledWith('v1');
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    });

    test('취소하면 지우지 않는다', async () => {
      await render(<ArchiveDetailScreen />);
      await fireEvent.press(await screen.findByRole('button', { name: /보관함에서 삭제/ }));
      await fireEvent.press(await screen.findByText('취소'));
      expect(deleteVideo).not.toHaveBeenCalled();
    });

    test('서버가 막으면 이유를 알리고 다시 읽는다', async () => {
      deleteVideo.mockRejectedValue(new ApiError(422, 'in use', 'validation_failed', 'video_in_use'));
      await render(<ArchiveDetailScreen />);
      await fireEvent.press(await screen.findByRole('button', { name: /보관함에서 삭제/ }));
      await confirmLast('삭제');

      expect(await screen.findAllByText('지울 수 없어요')).toHaveLength(2);
      expect(getVideo).toHaveBeenCalledTimes(2);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    test('쓰이는 영상은 사용처를 알리고 파일만 파기할 수 있다', async () => {
      getVideo.mockResolvedValue(inUse);
      purgeFile.mockResolvedValue({ ...inUse, purged_at: '2026-10-20T00:00:00Z', playback_url: null });
      await render(<ArchiveDetailScreen />);
      await fireEvent.press(await screen.findByRole('button', { name: /보관함에서 삭제/ }));

      expect(
        await screen.findByText('이 영상은 회차 2개 · 챌린지 참여작 1개에 쓰이고 있어요. 파일만 파기하면 기록은 남고 재생만 막혀요.'),
      ).toBeOnTheScreen();
      await fireEvent.press(screen.getByText('파일만 파기'));
      expect(await screen.findByText('파일만 파기할까요?')).toBeOnTheScreen();
      await confirmLast('파일만 파기');

      expect(purgeFile).toHaveBeenCalledWith('v1');
      expect(forgetLocalCopy).toHaveBeenCalledWith('v1');
      expect(await screen.findByText(/· 재생할 수 없어요$/)).toBeOnTheScreen();
      expect(deleteVideo).not.toHaveBeenCalled();
    });

    test('파기를 취소하면 그대로 두고, 실패하면 이유를 알린다', async () => {
      getVideo.mockResolvedValue(inUse);
      purgeFile.mockRejectedValue(new ApiError(422, 'quota', 'validation_failed', 'video_quota'));
      await render(<ArchiveDetailScreen />);

      await fireEvent.press(await screen.findByRole('button', { name: /보관함에서 삭제/ }));
      await fireEvent.press(await screen.findByText('파일만 파기'));
      await fireEvent.press(await screen.findByText('취소'));
      expect(purgeFile).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByRole('button', { name: /보관함에서 삭제/ }));
      await fireEvent.press(await screen.findByText('파일만 파기'));
      await confirmLast('파일만 파기');
      expect(
        await screen.findByText('보관함이 가득 찼어요. 영상을 지우거나 파일만 파기하면 다시 올릴 수 있어요.'),
      ).toBeOnTheScreen();
    });

    test('이미 파기한 쓰이는 영상은 사용처만 알린다', async () => {
      getVideo.mockResolvedValue({ ...inUse, purged_at: '2026-01-01T00:00:00Z' });
      await render(<ArchiveDetailScreen />);
      await fireEvent.press(await screen.findByRole('button', { name: /보관함에서 삭제/ }));

      expect(await screen.findByText(/에 쓰이고 있어요/)).toBeOnTheScreen();
      expect(screen.queryByText('파일만 파기')).not.toBeOnTheScreen();
    });
  });
});

describe('업로드 대기 촬영본', () => {
  beforeEach(() => {
    mockParams = { pending: 'q1' };
  });

  test('기기 파일로 보여 주고 다시 올리기를 둔다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([queuedVideo({ id: 'q1', durationMs: null })]);
    await render(<ArchiveDetailScreen />);

    expect(await screen.findByText('기기에 먼저 저장했어요. 연결되면 보관함에 올라가요.')).toBeOnTheScreen();
    expect(pendingLibraryUploads).toHaveBeenCalledWith('u1');
    expect(screen.getByText(/^오늘 .+ · — · 기기에 저장 · 업로드 대기$/)).toBeOnTheScreen();
    expect(screen.queryByText(/^사용처/)).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByText('다시 올리기'));
    expect(flushLibraryUploads).toHaveBeenCalledWith('u1');
  });

  test.each([
    ['failed' as const, 'video_too_long', '업로드 실패 · 다시 시도', '영상이 너무 길어요(5분 이내)'],
    ['uploading' as const, null, '올리는 중…', '기기에 먼저 저장했어요. 연결되면 보관함에 올라가요.'],
  ])('%s 상태를 보여 준다', async (status, lastError, label, hint) => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([queuedVideo({ id: 'q1', status, lastError })]);
    await render(<ArchiveDetailScreen />);

    expect(await screen.findByText(new RegExp(`· 0:12 · ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))).toBeOnTheScreen();
    expect(screen.getByText(hint)).toBeOnTheScreen();
  });

  test('코칭으로 보내면 대기 id와 기기 파일을 넘기고, 챌린지는 확정 뒤에만 된다고 알린다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([queuedVideo({ id: 'q1' })]);
    await render(<ArchiveDetailScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: /질문 코칭으로 보내기/ }));
    expect(setPickedVideo).toHaveBeenCalledWith({ videoId: null, pendingId: 'q1', uri: 'file:///q1.mp4', playbackUrl: null, durationMs: 12_000 });

    await fireEvent.press(screen.getByRole('button', { name: /챌린지에 올리기/ }));
    expect(logEvent).toHaveBeenCalledWith('archive_to_challenge', { id: 'q1' });
    expect(await screen.findByText('재생할 수 없어요')).toBeOnTheScreen();
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  test('대기에서 빼면 확인 뒤 지우고 돌아간다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([queuedVideo({ id: 'q1' })]);
    await render(<ArchiveDetailScreen />);

    await fireEvent.press(await screen.findByText('대기에서 빼기'));
    await confirmLast('삭제');

    expect(removePendingUpload).toHaveBeenCalledWith('q1');
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('빼기를 취소하면 남긴다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([queuedVideo({ id: 'q1' })]);
    await render(<ArchiveDetailScreen />);

    await fireEvent.press(await screen.findByText('대기에서 빼기'));
    await fireEvent.press(await screen.findByText('취소'));
    expect(removePendingUpload).not.toHaveBeenCalled();
  });

  test('그사이 올라갔으면 목록으로 돌아간다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([]);
    await render(<ArchiveDetailScreen />);
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  });

  test('보관함이 바뀌면 다시 읽는다', async () => {
    (pendingLibraryUploads as jest.Mock).mockResolvedValueOnce([queuedVideo({ id: 'q1' })]).mockResolvedValueOnce([]);
    await render(<ArchiveDetailScreen />);
    await screen.findByText('대기에서 빼기');

    await act(async () => libraryListener?.());
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

test.each([
  ['영상 id가 없으면', {}],
  ['영상을 못 읽으면', { id: 'v1' }],
])('%s 돌아간다', async (_name, params) => {
  mockParams = params;
  getVideo.mockRejectedValue(new Error('gone'));
  await render(<ArchiveDetailScreen />);
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
});

test('뒤로는 이전 화면으로 간다', async () => {
  await render(<ArchiveDetailScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
