import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer } from 'expo-video';

import UploadScreen from '@/app/upload';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import {
  confirmedVideoFor,
  flushLibraryUploads,
  onLibraryChange,
  pendingLibraryUploads,
  saveRecordingToLibrary,
} from '@/lib/library/library-runner';
import { setPickedVideo, takePickedVideo } from '@/lib/practice/picked-video';
import { setContinueOrigin } from '@/lib/practice/session-state';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
let mockFocusEffect: () => void = () => undefined;
const mockPlayer = { pause: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })), loop: true };

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  const { Text } = require('react-native');
  return {
    Stack: { Screen: ({ options }: { options?: { title?: string } }) => <Text>{options?.title}</Text> },
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true, usePreventRemove: jest.fn() }));
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((_source: unknown, setup?: (p: unknown) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  }),
  VideoView: () => null,
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/tutorial-loop', () => ({ sampleVideoUri: () => 'file:///sample.mp4' }));
jest.mock('@/lib/api', () => ({
  api: { getVideo: jest.fn(), createPractice: jest.fn(), continuePractice: jest.fn(), listPracticeGroups: jest.fn() },
}));
jest.mock('@/lib/library/library-runner', () => {
  const listeners = new Set<() => void>();
  return {
    confirmedVideoFor: jest.fn(() => null),
    flushLibraryUploads: jest.fn(async () => undefined),
    onLibraryChange: jest.fn((fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
    pendingLibraryUploads: jest.fn(async () => []),
    saveRecordingToLibrary: jest.fn(),
    __emit: () => listeners.forEach((fn) => fn()),
  };
});

async function returnWithPicked(video: Parameters<typeof setPickedVideo>[0]) {
  setPickedVideo(video);
  await act(async () => mockFocusEffect());
}

const emitLibraryChange = () => (jest.requireMock('@/lib/library/library-runner') as { __emit: () => void }).__emit();
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);

const serverError = (status: number, code?: string) => new ApiError(status, '서버 오류', code ?? 'unknown_error', code);

const RIGHTS = '본인이 촬영·업로드할 권리가 있고, 영상에 나오는 다른 사람의 촬영·처리 동의를 받았으며, 대본·음원·영상의 저작권과 초상권을 침해하지 않습니다.';

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  takePickedVideo();
  setContinueOrigin(null);
  (confirmedVideoFor as jest.Mock).mockReturnValue(null);
  (pendingLibraryUploads as jest.Mock).mockResolvedValue([]);
  (api.getVideo as jest.Mock).mockResolvedValue({ id: 'v1', playback_url: 'https://play/v1' });
  (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [] });
  (api.createPractice as jest.Mock).mockResolvedValue({ id: 'p1', ordinal: 1 });
  (api.continuePractice as jest.Mock).mockResolvedValue({ id: 'p2', ordinal: 2 });
});

async function renderWithSavedVideo() {
  setPickedVideo({ videoId: 'v1', pendingId: null, uri: null, playbackUrl: null, durationMs: 12_000 });
  await render(<UploadScreen />);
  await waitFor(() => expect(useVideoPlayer).toHaveBeenLastCalledWith('https://play/v1', expect.any(Function)));
}

// 세션 목적은 누르는 즉시 영상 단계로 넘어간다 — 「다음」 버튼이 없다(SOMA-778).
async function toSourceStep(purpose = '평가 받기') {
  await fireEvent.press(screen.getByRole('button', { name: purpose }));
  expect(screen.getByText('영상이 어디 있어요?')).toBeOnTheScreen();
}

async function checkRightsAndStart() {
  await fireEvent.press(screen.getByText(RIGHTS));
  await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
}

describe('영상을 고르기 전', () => {
  test('세션 목적부터 묻고, 목적을 누르면 바로 영상 고르기로 간다 — 나가면 영상 없이 나갔다고 센다', async () => {
    const view = await render(<UploadScreen />);

    expect(screen.getByText('새 연습')).toBeOnTheScreen();
    expect(screen.getByText('오늘은 어떤 도움이 필요해요?')).toBeOnTheScreen();
    // 단계는 목적 · 영상 둘이다. 장면 단계와 「다음」 버튼은 없다.
    expect(screen.getByText('목적')).toBeOnTheScreen();
    expect(screen.getByText('영상')).toBeOnTheScreen();
    expect(screen.queryByText('장면 · 질문')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeOnTheScreen();
    // 기본 목적은 있지만 직접 고르기 전에는 고른 것처럼 칠하지 않는다(10/22 피드백).
    expect(screen.getByRole('button', { name: '평가 받기' })).not.toBeSelected();
    await toSourceStep();
    // 영상 단계 맨 아래에 권리 체크와 시작 버튼이 있다 — 영상이 없으면 막혀 있다.
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('영상을 채워주세요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    expect(logged('practice_start_blocked')).toEqual([{ reason: 'no_video' }]);
    expect(api.createPractice).not.toHaveBeenCalled();

    await view.unmount();
    expect(logged('practice_upload_exit')).toEqual([
      { stage: 'no_video', source: 'none', rights: 'off', blocked_taps: 1, stay_s: 0 },
    ]);
  });

  test('영상 고르기에서 보관함은 보관함으로, 지금 찍기는 찍는 법 한 장으로 간다', async () => {
    await render(<UploadScreen />);
    await toSourceStep();

    await fireEvent.press(screen.getByRole('button', { name: '보관함에서 고르기' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/archive', params: { pick: '1' } });
    await fireEvent.press(screen.getByRole('button', { name: '지금 찍기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/record-guide', params: {} });
  });

  test('첫 코칭이어도 단계마다 「처음이면 ~를 누르세요」를 반복하지 않고, 찍는 법에는 첫 코칭이라고 넘긴다(10/20 피드백)', async () => {
    mockParams = { first: '1' };
    await render(<UploadScreen />);
    expect(screen.queryByText('처음이면 「평가 받기」를 누르세요.')).not.toBeOnTheScreen();
    await toSourceStep();
    expect(screen.queryByText('처음이면 「지금 찍기」를 누르세요.')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '지금 찍기' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/record-guide', params: { first: '1' } });
    // 영상을 고르고 와도 같은 안내를 반복하지 않는다.
    await returnWithPicked({ videoId: 'v1', pendingId: null, uri: 'file:///v1.mp4', playbackUrl: null, durationMs: 2_000, source: 'record' });
    expect(screen.queryByText('맨 아래 체크를 누른 뒤 「질문 받기」를 누르세요.')).not.toBeOnTheScreen();
  });

  test('영상 없이 뒤로 가면 이유를 묻고 건너뛰면 목적 단계로 돌아간다', async () => {
    const preventRemove = jest.requireMock('@react-navigation/native').usePreventRemove as jest.Mock;
    await render(<UploadScreen />);
    expect(preventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
    await toSourceStep();
    expect(preventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
    await act(async () => preventRemove.mock.calls[preventRemove.mock.calls.length - 1][1]());
    expect(screen.getByText('영상 올리기가 망설여지나요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('지금은 넘어갈게요'));
    expect(screen.getByText('오늘은 어떤 도움이 필요해요?')).toBeOnTheScreen();
  });

  test('고른 영상의 영상 다시 선택을 누르면 시트가 뜨고, 촬영을 고르면 시트가 닫힌 뒤 카메라로 간다', async () => {
    await renderWithSavedVideo();

    await fireEvent.press(screen.getByText('영상 다시 선택'));
    await fireEvent.press(screen.getByRole('button', { name: '촬영하기' }));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/record-video', params: { mode: 'ai' } }),
    );
    expect(screen.queryByRole('button', { name: '촬영하기' })).not.toBeOnTheScreen();
  });
});

describe('갤러리에서 고르기', () => {
  async function pickFromGallery() {
    await toSourceStep();
    await fireEvent.press(screen.getByRole('button', { name: '갤러리에서 고르기' }));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
  }

  test('고른 영상을 보관함 큐에 넣고, 올라가는 동안 질문 받기를 막고 업로드를 다시 민다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///g.mov', duration: 42_000.4 }],
    });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({
      kind: 'queued',
      entry: { id: 'pend-1', uri: 'file:///doc/g.mov' },
    });
    await render(<UploadScreen />);
    await pickFromGallery();

    expect(await screen.findByText('올리는 중…')).toBeOnTheScreen();
    expect(saveRecordingToLibrary).toHaveBeenCalledWith({ uri: 'file:///g.mov', durationMs: 42_000, owner: 'u1' });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['videos'], allowsEditing: true, quality: 1 });
    expect(useVideoPlayer).toHaveBeenLastCalledWith('file:///doc/g.mov', expect.any(Function));
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '업로드 중…' })).toBeOnTheScreen();
    expect(screen.getByText('영상을 아직 올리는 중이에요. 잠시 뒤에 다시 눌러 주세요.')).toBeOnTheScreen();
    expect(logged('practice_video_picked')).toEqual([{ source: 'gallery', needs_upload: 'yes', length: '30_60s' }]);

    await fireEvent.press(screen.getByRole('button', { name: '업로드 중…' }));
    expect(flushLibraryUploads).toHaveBeenCalledWith('u1');
    expect(logged('practice_start_blocked')).toEqual([{ reason: 'uploading' }]);
    expect(api.createPractice).not.toHaveBeenCalled();
  });

  test('올리기가 실패로 남으면 다시 올려 볼 수 있다고 알린다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///g.mov' }] });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'queued', entry: { id: 'pend-1', uri: 'file:///doc/g.mov' } });
    (pendingLibraryUploads as jest.Mock).mockResolvedValue([{ id: 'pend-1', status: 'failed' }]);
    await render(<UploadScreen />);
    await pickFromGallery();

    expect(await screen.findByText('영상을 올리지 못했어요. 질문 받기를 누르면 다시 올려 볼게요.')).toBeOnTheScreen();
    expect(pendingLibraryUploads).toHaveBeenCalledWith('u1');
  });

  test('올리기 상태를 못 읽어도 올리는 중으로 둔다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///g.mov' }] });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'queued', entry: { id: 'pend-1', uri: 'file:///doc/g.mov' } });
    (pendingLibraryUploads as jest.Mock).mockRejectedValue(new Error('storage'));
    await render(<UploadScreen />);
    await pickFromGallery();

    expect(await screen.findByText('영상을 아직 올리는 중이에요. 잠시 뒤에 다시 눌러 주세요.')).toBeOnTheScreen();
  });

  test('올리던 영상이 확정되면 질문 받기를 열고 기다린 시간을 센다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///g.mov' }] });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'queued', entry: { id: 'pend-1', uri: 'file:///doc/g.mov' } });
    await render(<UploadScreen />);
    await pickFromGallery();
    await screen.findByRole('button', { name: '업로드 중…' });

    (confirmedVideoFor as jest.Mock).mockImplementation((id: string) => (id === 'pend-1' ? 'v9' : null));
    await act(async () => emitLibraryChange());

    expect(await screen.findByText('보관함 저장')).toBeOnTheScreen();
    expect(logged('practice_video_ready')).toEqual([{ source: 'gallery', wait_s: 0 }]);
    await checkRightsAndStart();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p1' } }));
    expect((api.createPractice as jest.Mock).mock.calls[0][0].video_id).toBe('v9');
  });

  test('너무 긴 영상은 큐에 넣지 않고 알린다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///g.mov', duration: 400_000 }] });
    (saveRecordingToLibrary as jest.Mock).mockResolvedValue({ kind: 'rejected', code: 'video_too_long' });
    await render(<UploadScreen />);
    await pickFromGallery();

    expect(await screen.findByText('영상이 너무 길어요(5분 이내)')).toBeOnTheScreen();
    // 영상 고르기 단계에 그대로 머문다.
    expect(screen.getByText('영상이 어디 있어요?')).toBeOnTheScreen();
    expect(logged('practice_video_picked')).toEqual([]);
  });

  test('선택 창을 닫으면 아무것도 바뀌지 않는다', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    await render(<UploadScreen />);
    await pickFromGallery();

    expect(saveRecordingToLibrary).not.toHaveBeenCalled();
    expect(screen.getByText('영상이 어디 있어요?')).toBeOnTheScreen();
    expect(logged('practice_video_picked')).toEqual([]);
  });
});

describe('보관함에서 고른 영상으로 시작', () => {
  test('재생 주소를 받아 미리보기를 채우고, 권리를 체크하면 회차를 만들어 코치 화면(분석 대기)으로 간다', async () => {
    await renderWithSavedVideo();

    expect(screen.getByText('보관함 저장')).toBeOnTheScreen();
    expect(api.getVideo).toHaveBeenCalledWith('v1');
    expect(logged('practice_video_picked')).toEqual([{ source: 'library', needs_upload: 'no', length: '10_30s' }]);

    await fireEvent.press(screen.getByText('영상 다시 선택'));
    await fireEvent.press(screen.getByRole('button', { name: '보관함에서 고르기' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/archive', params: { pick: '1' } }));
    expect(screen.getByText('권리 확인에 체크해주세요')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    expect(logged('practice_start_blocked')).toEqual([{ reason: 'rights' }]);

    // 장면 칸(상황·인물·원하는 것)은 없다 — 영상과 권리 체크만으로 시작한다(SOMA-778).
    expect(screen.queryAllByPlaceholderText(/^예: /)).toHaveLength(0);
    await checkRightsAndStart();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p1' } }));
    expect(logged('practice_rights_toggle')).toEqual([{ checked: 'on' }]);
    expect(api.createPractice).toHaveBeenCalledWith({
      request_id: expect.any(String),
      video_id: 'v1',
      scene: { situation: '', character: '', goal: '' },
      blockage: { category: '그 외', detail: '그 외', note: null },
    });
    expect(logged('practice_start')).toEqual([{ ordinal: 1, continued: false }]);
  });

  test('세션 목적을 고르면 그 갈래로 막힌 곳을 보낸다 — 돌아가 다른 목적을 누르면 바꾼다', async () => {
    const preventRemove = jest.requireMock('@react-navigation/native').usePreventRemove as jest.Mock;
    await render(<UploadScreen />);
    await toSourceStep('막힌 곳 풀기');
    // 뒤로 가서 다른 목적을 고른다 — 고른 것만 선택돼 있다.
    await act(async () => preventRemove.mock.calls[preventRemove.mock.calls.length - 1][1]());
    await fireEvent.press(screen.getByText('지금은 넘어갈게요'));
    expect(screen.getByRole('button', { name: '막힌 곳 풀기' })).toBeSelected();
    await toSourceStep('인물 이해하기');
    await act(async () => preventRemove.mock.calls[preventRemove.mock.calls.length - 1][1]());
    await fireEvent.press(screen.getByText('지금은 넘어갈게요'));
    expect(screen.getByRole('button', { name: '인물 이해하기' })).toBeSelected();
    expect(screen.getByRole('button', { name: '막힌 곳 풀기' })).not.toBeSelected();
    await toSourceStep('인물 이해하기');
    await returnWithPicked({ videoId: 'v1', pendingId: null, uri: 'file:///v1.mp4', playbackUrl: null, durationMs: 2_000 });

    await checkRightsAndStart();
    await waitFor(() => expect(api.createPractice).toHaveBeenCalled());
    expect((api.createPractice as jest.Mock).mock.calls[0][0].blockage).toMatchObject({ category: '분석', note: null });
  });

  test('보내는 동안 입력을 잠그고 두 번 눌러도 한 번만 보낸다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    (api.createPractice as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
    await renderWithSavedVideo();
    await fireEvent.press(screen.getByText(RIGHTS));
    const submit = screen.getByRole('button', { name: '질문 받기' });
    await fireEvent.press(submit);
    await fireEvent.press(submit);

    expect(await screen.findByText('보내는 중이에요. 잠시만 기다려 주세요.')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(api.createPractice).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ id: 'p1', ordinal: 3 }));
    // 화면은 떠날 표시를 먼저 그리고 다음 틱에 옮긴다(leaveThen) — 옮김은 기다려서 본다.
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p1' } }));
  });

  test('목록에서 고른 영상의 재생 주소가 없으면 미리보기를 비운 채로 둔다', async () => {
    (api.getVideo as jest.Mock).mockResolvedValue({ id: 'v1', playback_url: null });
    setPickedVideo({ videoId: 'v1', pendingId: null, uri: null, playbackUrl: null, durationMs: null });
    await render(<UploadScreen />);
    await waitFor(() => expect(api.getVideo).toHaveBeenCalledWith('v1'));
    expect(useVideoPlayer).toHaveBeenLastCalledWith(null, expect.any(Function));
    expect(screen.getByText('보관함 저장')).toBeOnTheScreen();
  });

  test('상세를 못 받아도 화면은 그대로다', async () => {
    (api.getVideo as jest.Mock).mockRejectedValue(new Error('down'));
    setPickedVideo({ videoId: 'v1', pendingId: null, uri: null, playbackUrl: null, durationMs: null });
    await render(<UploadScreen />);
    await waitFor(() => expect(api.getVideo).toHaveBeenCalled());
    expect(screen.getByText('보관함 저장')).toBeOnTheScreen();
  });

  test('다른 영상의 상세가 늦게 오면 덮어쓰지 않는다', async () => {
    (api.getVideo as jest.Mock).mockResolvedValue({ id: 'other', playback_url: 'https://play/other' });
    setPickedVideo({ videoId: 'v1', pendingId: null, uri: null, playbackUrl: null, durationMs: null });
    await render(<UploadScreen />);
    await waitFor(() => expect(api.getVideo).toHaveBeenCalled());
    expect(useVideoPlayer).not.toHaveBeenCalledWith('https://play/other', expect.any(Function));
  });

  test('화면을 떠나면 상세 응답을 버린다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    (api.getVideo as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
    setPickedVideo({ videoId: 'v1', pendingId: null, uri: null, playbackUrl: null, durationMs: null });
    const view = await render(<UploadScreen />);
    await view.unmount();
    await act(async () => resolve({ id: 'v1', playback_url: 'https://play/v1' }));
    expect(useVideoPlayer).not.toHaveBeenCalledWith('https://play/v1', expect.any(Function));
  });
});

describe('시작이 실패하면', () => {
  test.each([
    ['영상이 아직 확정 전', serverError(422, 'video_not_ready'), '영상을 아직 올리는 중이에요. 잠시 뒤에 다시 눌러 주세요.'],
    ['오늘 분석을 다 씀', serverError(429, 'guest_daily_analysis_limit'), '오늘 분석을 다 썼어요. 내일 다시 할 수 있어요.'],
    ['연결이 끊김', serverError(503), '연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.'],
    ['그 밖의 서버 오류', new ApiError(400, '잘못된 요청이에요'), '잘못된 요청이에요'],
  ])('%s: 알맞은 문구를 보여 주고 머문다', async (_name, error, message) => {
    (api.createPractice as jest.Mock).mockRejectedValue(error);
    await renderWithSavedVideo();
    await checkRightsAndStart();

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '질문 받기' })).toBeOnTheScreen();
  });

  test('같은 요청 id로 다른 본문을 보냈다고 하면 다음 시도는 새 요청 id를 쓴다', async () => {
    (api.createPractice as jest.Mock)
      .mockRejectedValueOnce(serverError(422, 'request_fingerprint_mismatch'))
      .mockRejectedValueOnce(serverError(503))
      .mockResolvedValueOnce({ id: 'p1', ordinal: 1 });
    await renderWithSavedVideo();
    await checkRightsAndStart();
    await screen.findByText('요청 내용이 바뀌었어요. 다시 보내 주세요.');

    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.');
    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());

    const ids = (api.createPractice as jest.Mock).mock.calls.map(([body]) => body.request_id);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ids[2]).toBe(ids[1]);
  });

  test('진행 중인 회차가 있으면 알리고 그 회차의 코치 화면으로 돌려보낸다', async () => {
    (api.createPractice as jest.Mock).mockRejectedValue(serverError(409, 'practice_in_progress'));
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({
      groups: [{ root_id: 'r1', in_progress_practice_id: 'open-1' }],
    });
    await renderWithSavedVideo();
    await checkRightsAndStart();

    expect(await screen.findByText('진행 중인 연습이 있어요')).toBeOnTheScreen();
    expect(api.listPracticeGroups).toHaveBeenCalledWith('all');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'open-1' } }));
  });

  test('진행 중이라는데 그 회차를 찾지 못하면 먼저 마치라고 알린다', async () => {
    (api.createPractice as jest.Mock).mockRejectedValue(serverError(409));
    (api.listPracticeGroups as jest.Mock).mockRejectedValue(new Error('down'));
    await renderWithSavedVideo();
    await checkRightsAndStart();

    expect(await screen.findByText('먼저 하던 연습을 마치거나 그만둔 뒤에 새 연습을 시작할 수 있어요.')).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('보내기 전에 화면이 먼저 막는 길이', () => {
  test('리딩에서 넘겨받은 장면이 300자를 넘으면 보내지 않는다', async () => {
    setContinueOrigin({ kind: 'reading', scene: { situation: '', character: '가'.repeat(301), goal: '' } });
    await renderWithSavedVideo();
    await checkRightsAndStart();

    expect(await screen.findByText('상황·인물·목표는 각각 300자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(api.createPractice).not.toHaveBeenCalled();
  });

  test('준비 화면에 장면·연습 제목 칸이 없고 시작 본문에 title 이 실리지 않는다', async () => {
    await renderWithSavedVideo();
    expect(screen.queryByText('연습 제목')).not.toBeOnTheScreen();
    expect(screen.queryByText('상황')).not.toBeOnTheScreen();
    expect(screen.queryByText('원하는 것')).not.toBeOnTheScreen();
    expect(screen.queryAllByPlaceholderText(/^예: /)).toHaveLength(0);
    await checkRightsAndStart();

    await waitFor(() => expect(api.createPractice).toHaveBeenCalled());
    expect((api.createPractice as jest.Mock).mock.calls[0][0]).not.toHaveProperty('title');
  });

  test('이어받은 장면이 300자를 넘으면 보내지 않는다', async () => {
    setContinueOrigin({
      kind: 'note',
      rootId: 'r1',
      practiceId: 'p0',
      scene: { situation: '가'.repeat(301), character: '', goal: '' },
    });
    await render(<UploadScreen />);
    await returnWithPicked({ videoId: 'v1', pendingId: null, uri: 'file:///v1.mp4', playbackUrl: null, durationMs: 2_000, source: 'record' });
    await fireEvent.press(screen.getByText(RIGHTS));
    await fireEvent.press(screen.getByRole('button', { name: '이대로 이어가기' }));

    expect(await screen.findByText('상황·인물·목표는 각각 300자까지 쓸 수 있어요.')).toBeOnTheScreen();
    expect(api.continuePractice).not.toHaveBeenCalled();
  });
});

describe('다음 테이크', () => {
  test('노트에서 이어오면 지난 장면을 그대로 실어 같은 묶음에 이어 만든다', async () => {
    setContinueOrigin({
      kind: 'note',
      rootId: 'r1',
      practiceId: 'p0',
      scene: { situation: '카페', character: '서연', goal: '' },
    });
    await render(<UploadScreen />);
    await returnWithPicked({ videoId: 'v1', pendingId: null, uri: 'file:///v1.mp4', playbackUrl: null, durationMs: 2_000, source: 'record' });

    expect(screen.getByText('다음 테이크 찍기')).toBeOnTheScreen();
    expect(logged('practice_video_picked')).toEqual([{ source: 'record', needs_upload: 'no', length: 'lt3s' }]);
    expect(screen.queryByPlaceholderText('예: 카페 이별 장면 2차')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText(RIGHTS));
    await fireEvent.press(screen.getByRole('button', { name: '이대로 이어가기' }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p2' } }));
    expect(api.continuePractice).toHaveBeenCalledWith('p0', {
      request_id: expect.any(String),
      video_id: 'v1',
      scene: { situation: '카페', character: '서연', goal: '' },
      blockage: { category: '그 외', detail: '그 외', note: null },
    });
    expect(logged('practice_start')).toEqual([{ ordinal: 2, continued: true }]);
  });

  test('리딩에서 넘어오면 대본의 장면을 화면 없이 그대로 실어 새 연습을 만든다', async () => {
    setContinueOrigin({ kind: 'reading', scene: { situation: '카페', character: '서연', goal: '붙잡지 않게' } });
    await renderWithSavedVideo();

    expect(screen.getByText('새 연습')).toBeOnTheScreen();
    expect(screen.queryByText('카페')).not.toBeOnTheScreen();
    await checkRightsAndStart();

    await waitFor(() => expect(api.createPractice).toHaveBeenCalled());
    expect((api.createPractice as jest.Mock).mock.calls[0][0].scene).toEqual({ situation: '카페', character: '서연', goal: '붙잡지 않게' });
  });

  test('기록에서 이어오면 남아 있던 영상을 버리고 영상 고르기부터 한다', async () => {
    setPickedVideo({ videoId: 'stale', pendingId: null, uri: 'file:///stale.mp4', playbackUrl: null, durationMs: null });
    setContinueOrigin({ kind: 'group', rootId: 'r1', practiceId: 'p0' });
    await render(<UploadScreen />);

    expect(screen.getByText('다음 테이크 찍기')).toBeOnTheScreen();
    expect(useVideoPlayer).not.toHaveBeenCalledWith('file:///stale.mp4', expect.any(Function));
    await toSourceStep();
  });

  test('진행 중 회차는 이어 가는 묶음 안에서만 찾는다', async () => {
    setContinueOrigin({ kind: 'group', rootId: 'r1', practiceId: 'p0' });
    (api.continuePractice as jest.Mock).mockRejectedValue(serverError(409, 'practice_in_progress'));
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({
      groups: [
        { root_id: 'r2', in_progress_practice_id: 'elsewhere' },
        { root_id: 'r1', in_progress_practice_id: 'open-r1' },
      ],
    });
    await render(<UploadScreen />);
    await returnWithPicked({ videoId: 'v1', pendingId: null, uri: 'file:///v1.mp4', playbackUrl: null, durationMs: 2_000, source: 'record' });
    await checkRightsAndStart();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'open-r1' } }));
  });
});

describe('튜토리얼 예시', () => {
  test('예시 영상과 장면을 채워 두고 시작하면 서버 없이 예시 회차로 간다', async () => {
    mockParams = { sample: '1' };
    const view = await render(<UploadScreen />);

    expect(screen.getByText('예시')).toBeOnTheScreen();
    expect(screen.getByText('카페에서 오래 만난 연인에게 헤어지자는 말을 꺼내는 장면')).toBeOnTheScreen();
    // 예시는 바로 영상 단계(2단계)에서 연다.
    expect(screen.queryByText('오늘은 어떤 도움이 필요해요?')).not.toBeOnTheScreen();
    expect(screen.queryByText('영상 다시 선택')).not.toBeOnTheScreen();
    expect(screen.queryByPlaceholderText('예: 카페 이별 장면 2차')).not.toBeOnTheScreen();
    expect(useVideoPlayer).toHaveBeenLastCalledWith('file:///sample.mp4', expect.any(Function));

    await fireEvent.press(screen.getByText(RIGHTS));
    expect(screen.getByText('권리 확인에 체크해주세요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText(RIGHTS));
    await fireEvent.press(screen.getByRole('button', { name: '질문 받기' }));
    // 화면은 떠날 표시를 먼저 그리고 다음 틱에 옮긴다(leaveThen) — 부하가 크면 누른 직후엔 아직이라 기다려서 본다.
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/coach',
        params: { practiceId: 'tutorial-sample-practice' },
      }),
    );
    expect(api.createPractice).not.toHaveBeenCalled();

    await view.unmount();
    expect(logEvent).not.toHaveBeenCalledWith('practice_upload_exit', expect.anything());
    expect(logEvent).not.toHaveBeenCalledWith('practice_rights_toggle', expect.anything());
    expect(logEvent).not.toHaveBeenCalledWith('practice_start_blocked', expect.anything());
  });
});

test('보관함 변경 구독은 화면을 떠나면 푼다', async () => {
  setPickedVideo({ videoId: null, pendingId: 'pend-1', uri: 'file:///p.mov', playbackUrl: null, durationMs: null });
  const view = await render(<UploadScreen />);
  const subscribed = (onLibraryChange as jest.Mock).mock.results.length;
  expect(subscribed).toBeGreaterThan(0);
  await view.unmount();
  (confirmedVideoFor as jest.Mock).mockReturnValue('v1');
  emitLibraryChange();
  expect(logged('practice_video_ready')).toEqual([]);
});

describe('영상 업로드를 망설일 때', () => {
  async function openReasons() {
    await render(<UploadScreen />);
    await toSourceStep();
    await fireEvent.press(screen.getByRole('button', { name: '영상 없어요' }));
    expect(screen.getByText('영상 올리기가 망설여지나요?')).toBeOnTheScreen();
  }

  test.each([
    ['아직 찍어 둔 영상이 없어요', 'no_video', '영상 없이 말로 코칭 받기', 'talk', '/talk'],
    ['얼굴을 보이기가 부담스러워요', 'privacy', '찍을 대사부터 같이 만들기', 'script', '/script-cocreate'],
    ['다른 이유가 있어요', 'other', '지금 찍기', 'record', '/record-guide'],
  ])('%s에서 %s 이유와 다음 경로를 기록하고 이동한다', async (label, reason, button, destination, path) => {
    mockParams = { first: '1' };
    await openReasons();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(logged('practice_upload_decline_reason')).toEqual([{ reason }]);
    expect(screen.getByText('이렇게 시작해 볼까요?')).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByText('이렇게 시작해 볼까요?').parent!).getByRole('button', { name: button }));
    expect(screen.queryByText('이렇게 시작해 볼까요?')).not.toBeOnTheScreen();
    expect(logged('practice_upload_decline_route')).toEqual([{ reason, destination }]);
    await waitFor(() => {
      if (destination === 'record') {
        expect(mockRouter.push).toHaveBeenCalledWith({ pathname: path, params: { first: '1' } });
      } else {
        expect(mockRouter.replace).toHaveBeenCalledWith(path);
      }
    });
    expect(jest.requireMock('@react-navigation/native').usePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  test.each([false, true])('건너뛰면 목적 단계로 돌아가고 이동하지 않는다 (이유 선택: %s)', async (chooseReason) => {
    await openReasons();
    if (chooseReason) await fireEvent.press(screen.getByRole('button', { name: '다른 이유가 있어요' }));
    await fireEvent.press(screen.getByRole('button', { name: '지금은 넘어갈게요' }));
    expect(screen.getByText('오늘은 어떤 도움이 필요해요?')).toBeOnTheScreen();
    expect(screen.queryByText('영상 올리기가 망설여지나요?')).not.toBeOnTheScreen();
    expect(logged('practice_upload_decline_route')).toEqual([{ reason: chooseReason ? 'other' : 'skipped', destination: 'skip' }]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(logged('practice_upload_decline_reason')).toEqual(chooseReason ? [{ reason: 'other' }] : []);
  });
});
