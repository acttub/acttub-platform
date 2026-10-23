import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ChallengeUploadScreen from '@/app/challenge-upload';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { hasFinishedFirstChallenge } from '@/lib/challenge/intro-state';
import type { ChallengeDetail } from '@/lib/challenge/types';
import { confirmedVideoFor, flushLibraryUploads, localCopyFor, onLibraryChange, saveRecordingToLibrary } from '@/lib/library/library-runner';
import { takeRecordedVideo } from '@/lib/recorded-video';
import { challengeCard, ENDED_AT, RUNNING_ENDS_AT } from '../helpers/challenge-card';

const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockParams: Record<string, string | undefined> = {};
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
      const player = { play: () => undefined };
      setup?.(player);
      return player;
    },
    VideoView: () => <Text>미리보기 영상</Text>,
  };
});
jest.mock('@/lib/api', () => ({ api: { getChallenge: jest.fn(), createEntry: jest.fn(), getEntry: jest.fn() } }));
jest.mock('@/lib/challenge/share-native', () => ({
  videoDeps: { download: jest.fn(), remove: jest.fn() },
  isInstagramInstalled: jest.fn(async () => true),
  instagramStoreUrl: jest.fn(() => null),
  shareVideoToInstagramStory: jest.fn(),
  saveVideoToLibrary: jest.fn(),
  copyText: jest.fn(),
  openSystemShare: jest.fn(),
  openSystemShareWithVideo: jest.fn(),
  openUrl: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/challenge/intro-state', () => ({
  hasFinishedFirstChallenge: jest.fn(async () => false),
  markFirstChallengeFinished: jest.fn(async () => undefined),
}));
jest.mock('@/lib/recorded-video', () => ({ takeRecordedVideo: jest.fn() }));
jest.mock('@/lib/library/library-runner', () => ({
  confirmedVideoFor: jest.fn(),
  flushLibraryUploads: jest.fn(),
  localCopyFor: jest.fn(),
  onLibraryChange: jest.fn(),
  saveRecordingToLibrary: jest.fn(),
}));

const getChallenge = api.getChallenge as jest.Mock;
const createEntry = api.createEntry as jest.Mock;
const httpError = (status: number, code?: string) => Object.assign(new Error(`http ${status}`), { status, code });
const events = () => (logEvent as jest.Mock).mock.calls;

const running: ChallengeDetail = {
  ...challengeCard({ id: 'c1', line: '사느냐 죽느냐', work: '햄릿', ends_at: RUNNING_ENDS_AT }),
  ranking_state: null,
};

let libraryListener: (() => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { challengeId: 'c1', videoId: 'v1' };
  getChallenge.mockResolvedValue(running);
  (hasFinishedFirstChallenge as jest.Mock).mockResolvedValue(false);
  createEntry.mockResolvedValue({ id: 'entry-1' });
  (takeRecordedVideo as jest.Mock).mockReturnValue(null);
  (localCopyFor as jest.Mock).mockResolvedValue(null);
  (confirmedVideoFor as jest.Mock).mockReturnValue(null);
  (flushLibraryUploads as jest.Mock).mockResolvedValue(undefined);
  (onLibraryChange as jest.Mock).mockImplementation((fn: () => void) => {
    libraryListener = fn;
    return () => {
      libraryListener = null;
    };
  });
});

const submitButton = () => screen.getByRole('button', { name: '올리기' });
const PUBLIC = /^공개로 올리기$/;
const PRIVATE = /^나만 보기$/;


test('보관함 영상으로 올리면 「공개」가 위에 먼저 골라져 있고, 올린 뒤 완료 화면에서 SNS 공유·코칭·다른 참여작·홈으로 이어진다', async () => {
  (localCopyFor as jest.Mock).mockResolvedValue('file:///copy.mp4');
  await render(<ChallengeUploadScreen />);

  expect(await screen.findByText('미리보기 영상')).toBeOnTheScreen();
  expect(localCopyFor).toHaveBeenCalledWith('v1');
  expect(events()).toContainEqual(['challenge_upload_succeeded', { origin: 'library' }]);
  // 액티 말풍선과 안내, 그리고 「공개」가 먼저 골라져 있다(pen C9.16·C9.17).
  expect(screen.getByText('공개 범위')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: PUBLIC })).toBeSelected();
  expect(screen.getByRole('radio', { name: PRIVATE })).not.toBeSelected();
  expect(screen.queryByText(/AI 리포트/)).not.toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText('캡션을 입력하세요 (선택)'), ' 첫 도전 ');
  expect(screen.getByText('6 / 300')).toBeOnTheScreen();

  await fireEvent.press(submitButton());

  expect(createEntry).toHaveBeenCalledWith('c1', {
    request_id: expect.stringMatching(/^\d+-[a-z0-9]+$/),
    video_id: 'v1',
    visibility: 'public',
    caption: '첫 도전',
  });
  expect(logEvent).toHaveBeenCalledWith('challenge_entry_created', { visibility: 'public' });
  // 처음 참여면 칭찬 화면(C19.3): 홈으로 가기 + 글자 「SNS에 공유하기」.
  expect(await screen.findByText(/첫 챌린지 해냈어요\./)).toBeOnTheScreen();
  expect(screen.getByText(/“사느냐 죽느냐”.*공개/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '홈으로 가기' })).toBeOnTheScreen();
  expect(screen.queryByText('AI 리포트 보기')).not.toBeOnTheScreen();
  // 첫 참여에서도 코칭으로 바로 이어진다(폰 테스트 10/23).
  await fireEvent.press(screen.getByRole('button', { name: '이 영상으로 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
  (api.getEntry as jest.Mock).mockResolvedValue({
    id: 'entry-1', is_mine: true, published_at: '2026-10-20T00:00:00Z', playback_url: 'https://v/1.mp4', author: { name: '나' },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'SNS에 공유하기' }));
  expect(logEvent).toHaveBeenCalledWith('challenge_upload_share', { visibility: 'public' });
  expect(await screen.findByText('영상으로 저장')).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('닫기'));
  await fireEvent.press(screen.getByRole('button', { name: '홈으로 가기' }));
  expect(mockRouter.replace).toHaveBeenLastCalledWith('/');
});

test('처음이 아니면 완료 화면에 SNS 공유·이 영상으로 코칭 받기·다른 참여작 보기 줄이 나온다', async () => {
  (hasFinishedFirstChallenge as jest.Mock).mockResolvedValue(true);
  await render(<ChallengeUploadScreen />);
  await screen.findByText('미리보기 영상').catch(() => undefined);
  await fireEvent.press(submitButton());

  expect(await screen.findByText('챌린지에 올렸어요!')).toBeOnTheScreen();
  expect(screen.getByText('SNS에 공유하기')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이 영상으로 코칭 받기' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
  await fireEvent.press(screen.getByRole('button', { name: '다른 참여작 보기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/challenge-play', params: { id: 'c1' } });
});

test('공개를 고르면 얼굴 모자이크를 켤 수 있고(기본 꺼짐), 켜면 요청에 싣고 만드는 중이라고 알린다', async () => {
  await render(<ChallengeUploadScreen />);
  await screen.findByText('공개 범위');
  // 나만 보기에서는 보이지 않는다.
  await fireEvent.press(screen.getByRole('radio', { name: PRIVATE }));
  expect(screen.queryByText('얼굴 모자이크')).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: PUBLIC }));
  const toggle = screen.getByLabelText('얼굴 모자이크');
  expect(toggle.props.value).toBe(false);
  await fireEvent(toggle, 'valueChange', true);
  await fireEvent.press(submitButton());
  expect(createEntry).toHaveBeenCalledWith('c1', expect.objectContaining({ visibility: 'public', face_mosaic: true }));
  expect(await screen.findByText(/얼굴 모자이크를 만드는 중이에요\. 다 되면 다른 배우들에게 보여요\./)).toBeOnTheScreen();
});

test('비공개를 고르면 비공개로 저장하고 완료 문구가 다르다', async () => {
  const view = await render(<ChallengeUploadScreen />);
  await screen.findByText('공개 범위');

  await fireEvent.press(screen.getByRole('radio', { name: PRIVATE }));
  await fireEvent.press(screen.getByRole('radio', { name: PRIVATE }));
  expect(events().filter(([name]) => name === 'challenge_visibility_selected')).toEqual([
    ['challenge_visibility_selected', { visibility: 'private' }],
  ]);
  await fireEvent.press(submitButton());

  expect(createEntry).toHaveBeenCalledWith('c1', expect.objectContaining({ video_id: 'v1', visibility: 'private' }));
  expect(createEntry.mock.calls[0][1]).not.toHaveProperty('caption');
  // 공개·비공개 완료 화면은 같은 모양에 제목만 다르다(C9.12) — 처음 참여면 칭찬 제목이다.
  expect(await screen.findByText(/첫 챌린지 해냈어요\./)).toBeOnTheScreen();
  expect(screen.getByText(/나만 보기/)).toBeOnTheScreen();
  expect(screen.queryByText('SNS에 공유하기')).not.toBeOnTheScreen();

  await view.unmount();
  expect(events().some(([name]) => name === 'challenge_upload_exit')).toBe(false);
});

test('같은 내용을 다시 보내면 같은 요청 id를 쓰고, 지문이 어긋났다는 답 뒤에는 새 id를 쓴다', async () => {
  createEntry
    .mockRejectedValueOnce(httpError(409, 'duplicate_entry'))
    .mockRejectedValueOnce(httpError(409, 'request_fingerprint_mismatch'))
    .mockResolvedValueOnce({ id: 'entry-1' });
  await render(<ChallengeUploadScreen />);
  await screen.findByText('공개 범위');

  await fireEvent.press(submitButton());
  expect(await screen.findByText('이 영상으로 이미 참여했어요. 다른 영상으로 올려 주세요.')).toBeOnTheScreen();
  expect(events()).toContainEqual(['challenge_submit_failed', { reason: 'duplicate' }]);
  await fireEvent.press(submitButton());
  expect(await screen.findByText('적은 내용을 다시 확인해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(submitButton());
  expect(await screen.findByText(/첫 챌린지 해냈어요\./)).toBeOnTheScreen();

  const ids = createEntry.mock.calls.map(([, body]) => body.request_id);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[1]);
});

test('끝난 챌린지에는 올릴 수 없다고 알리고 버튼을 막는다', async () => {
  getChallenge.mockResolvedValue({ ...running, ends_at: ENDED_AT });
  await render(<ChallengeUploadScreen />);

  expect(await screen.findByText('이 챌린지는 끝났어요. 영상은 그대로 있어요.')).toBeOnTheScreen();
  expect(submitButton()).toBeDisabled();
});

test('챌린지를 못 읽으면 없다고 알리고 넘겨받은 대사를 보여 준다', async () => {
  mockParams = { challengeId: 'c1', videoId: 'v1', line: '넘겨받은 대사', work: '넘겨받은 작품' };
  getChallenge.mockRejectedValue(httpError(404));
  await render(<ChallengeUploadScreen />);

  expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
});

test('길이 한도를 넘는 캡션이 들어오면 다시 확인하라고 하고 버튼을 막는다', async () => {
  await render(<ChallengeUploadScreen />);
  await screen.findByText('공개 범위');
  await fireEvent.changeText(screen.getByPlaceholderText('캡션을 입력하세요 (선택)'), '가'.repeat(301));

  expect(screen.getByText('적은 내용을 다시 확인해 주세요.')).toBeOnTheScreen();
  expect(submitButton()).toBeDisabled();
});

test('제출 없이 떠나면 어디까지 왔는지 남긴다', async () => {
  mockParams = { challengeId: 'c1' };
  const view = await render(<ChallengeUploadScreen />);
  await screen.findByText('공개 범위');
  await view.unmount();

  expect(events()).toContainEqual(['challenge_upload_exit', { stage: 'no_video', visibility: 'public', stay_s: '0' }]);
});

describe('방금 찍은 영상', () => {
  beforeEach(() => {
    mockParams = { challengeId: 'c1' };
  });

  test('보관함 큐가 확정할 때까지 기다렸다가 그 영상으로 올린다', async () => {
    (takeRecordedVideo as jest.Mock).mockReturnValue({ uri: 'file:///rec.mp4', durationMs: 10_000 });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'queued', entry: { id: 'q1' } });
    await render(<ChallengeUploadScreen />);

    expect(await screen.findByText('영상을 올리는 중이에요. 잠시 뒤 다시 눌러 주세요.')).toBeOnTheScreen();
    expect(saveRecordingToLibrary).toHaveBeenCalledWith({ uri: 'file:///rec.mp4', durationMs: 10_000, owner: 'u1' });
    expect(events()).toContainEqual(['challenge_upload_started', { origin: 'new' }]);
    expect(screen.getByText('미리보기 영상')).toBeOnTheScreen();
    expect(submitButton()).toBeDisabled();

    (confirmedVideoFor as jest.Mock).mockImplementation((id: string) => (id === 'q1' ? 'v9' : null));
    await act(async () => libraryListener?.());

    expect(screen.queryByText('영상을 올리는 중이에요. 잠시 뒤 다시 눌러 주세요.')).not.toBeOnTheScreen();
    expect(events()).toContainEqual(['challenge_upload_succeeded', { origin: 'new' }]);
    await fireEvent.press(submitButton());
    expect(createEntry).toHaveBeenCalledWith('c1', expect.objectContaining({ video_id: 'v9' }));
  });

  test('60초를 넘으면 올리지 않고 길다고 알린다', async () => {
    (takeRecordedVideo as jest.Mock).mockReturnValue({ uri: 'file:///rec.mp4', durationMs: 61_000 });
    await render(<ChallengeUploadScreen />);

    expect(await screen.findByText('챌린지 영상은 60초까지예요.')).toBeOnTheScreen();
    expect(events()).toContainEqual(['challenge_upload_failed', { reason: 'video_too_long' }]);
    expect(saveRecordingToLibrary).not.toHaveBeenCalled();
  });

  test('3초보다 짧으면 다시 찍으라고 한다', async () => {
    (takeRecordedVideo as jest.Mock).mockReturnValue({ uri: 'file:///rec.mp4', durationMs: 2_000 });
    await render(<ChallengeUploadScreen />);
    expect(await screen.findByText('영상이 너무 짧아요. 3초 이상 촬영해 주세요.')).toBeOnTheScreen();
    expect(saveRecordingToLibrary).not.toHaveBeenCalled();
  });

  test('보관함이 받지 않으면 실패를 남기고 알린다', async () => {
    (takeRecordedVideo as jest.Mock).mockReturnValue({ uri: 'file:///rec.mp4', durationMs: null });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'rejected', code: 'video_empty' });
    await render(<ChallengeUploadScreen />);

    expect(await screen.findByText('챌린지 영상은 60초까지예요.')).toBeOnTheScreen();
    expect(events()).toContainEqual(['challenge_upload_failed', { reason: 'video_empty' }]);
  });

  test('보관함 영상 id로 열었으면 방금 찍은 영상은 쓰지 않는다', async () => {
    mockParams = { challengeId: 'c1', videoId: 'v1' };
    (takeRecordedVideo as jest.Mock).mockReturnValue({ uri: 'file:///rec.mp4', durationMs: 10_000 });
    await render(<ChallengeUploadScreen />);
    await waitFor(() => expect(localCopyFor).toHaveBeenCalledWith('v1'));
    expect(saveRecordingToLibrary).not.toHaveBeenCalled();
    expect(screen.queryByText('미리보기 영상')).not.toBeOnTheScreen();
  });
});

test('챌린지 id 없이 열면 읽지도 올리지도 않는다', async () => {
  mockParams = { videoId: 'v1' };
  await render(<ChallengeUploadScreen />);
  await fireEvent.press(submitButton());

  expect(screen.getByRole('radio', { name: PUBLIC })).toBeSelected();
  await waitFor(() => expect(createEntry).not.toHaveBeenCalled());
  expect(getChallenge).not.toHaveBeenCalled();
});
