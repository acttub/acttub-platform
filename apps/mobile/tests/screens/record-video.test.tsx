import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import RecordVideoScreen from '@/app/record-video';
import { keepDeviceFile } from '@/lib/account-files';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { saveRecordingToLibrary } from '@/lib/library/library-runner';
import { takePickedVideo } from '@/lib/practice/picked-video';
import { setRecordScript, takeRecordScript } from '@/lib/practice/record-script';
import { peekRecordedVideo, takeRecordedVideo } from '@/lib/recorded-video';

type Perm = { granted: boolean; canAskAgain: boolean } | null;

const GRANTED = { granted: true, canAskAgain: true };
const DENIED = { granted: false, canAskAgain: true };
const BLOCKED = { granted: false, canAskAgain: false };

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
let mockCameraReadySignal = true;
let mockUser: { id: string } | null = { id: 'u1' };
let mockCamPerm: Perm = GRANTED;
let mockMicPerm: Perm = GRANTED;
const mockRequestCam = jest.fn();
const mockRequestMic = jest.fn();
const mockCamera = { recordAsync: jest.fn(), stopRecording: jest.fn() };

jest.mock('expo-camera', () => {
  const { forwardRef, useEffect, useImperativeHandle, useState } = require('react');
  const { Text } = require('react-native');
  // 실제 훅처럼 요청 결과로 권한 상태가 바뀐다.
  const permissionHook = (initial: () => unknown, request: () => Promise<unknown>) => () => {
    const [perm, setPerm] = useState(initial);
    const ask = async () => {
      const next = await request();
      setPerm(next);
      return next;
    };
    return [perm, ask];
  };
  const CameraView = forwardRef(({ facing, onCameraReady }: { facing: string; onCameraReady?: () => void }, ref: unknown) => {
    useImperativeHandle(ref, () => mockCamera);
    // 실제 카메라처럼 세션이 준비되면 알린다. mockCameraReadySignal 이 false 면 알리지 않는다(iOS 준비 전 셔터 시험).
    useEffect(() => {
      if (mockCameraReadySignal) onCameraReady?.();
    }, [onCameraReady]);
    return <Text>{`camera:${facing}`}</Text>;
  });
  CameraView.displayName = 'CameraView';
  return {
    CameraView,
    useCameraPermissions: permissionHook(() => mockCamPerm, () => mockRequestCam()),
    useMicrophonePermissions: permissionHook(() => mockMicPerm, () => mockRequestMic()),
  };
});
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/api', () => ({ api: { listChallenges: jest.fn() } }));
jest.mock('@/lib/account-files', () => ({ keepDeviceFile: jest.fn(async () => undefined) }));
jest.mock('@/lib/library/library-runner', () => ({ saveRecordingToLibrary: jest.fn() }));

const launchPicker = ImagePicker.launchImageLibraryAsync as jest.Mock;
const listChallenges = api.listChallenges as jest.Mock;
const saveToLibrary = saveRecordingToLibrary as jest.Mock;
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);

let finishRecording: (result: { uri?: string } | undefined) => void = () => undefined;
let failRecording: (error: Error) => void = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockCameraReadySignal = true;
  mockUser = { id: 'u1' };
  mockCamPerm = GRANTED;
  mockMicPerm = GRANTED;
  takeRecordedVideo();
  takePickedVideo();
  mockCamera.recordAsync.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finishRecording = resolve;
        failRecording = reject;
      }),
  );
  mockCamera.stopRecording.mockImplementation(() => finishRecording({ uri: 'file:///rec.mov' }));
  saveToLibrary.mockResolvedValue({ kind: 'queued', entry: { id: 'pend1', uri: 'file:///lib/pend1.mov' } });
});

afterEach(() => {
  jest.useRealTimers();
});

async function startRecording() {
  await fireEvent.press(screen.getByLabelText('촬영 시작'));
}

async function stopRecording() {
  await fireEvent.press(screen.getByLabelText('촬영 종료'));
}

async function recordAndStop() {
  await startRecording();
  await stopRecording();
}

/** 화면을 옆으로 넘긴다 — 촬영 화면이 받는 PanResponder 에 손가락 한 개의 움직임을 흘려 넣는다. */
async function swipe(dx: number, dy = 0) {
  const surface = screen.container.queryAll((node) => typeof node.props.onMoveShouldSetResponder === 'function')[0];
  const touchHistory = (ts: number, x: number, y: number) => ({
    numberActiveTouches: 1,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: ts,
    touchBank: [
      {
        touchActive: true,
        startPageX: 200,
        startPageY: 400,
        startTimeStamp: 1,
        currentPageX: x,
        currentPageY: y,
        currentTimeStamp: ts,
        previousPageX: 200,
        previousPageY: 400,
        previousTimeStamp: 1,
      },
    ],
  });
  const event = (ts: number, x: number, y: number) => ({ nativeEvent: { touches: [{}] }, touchHistory: touchHistory(ts, x, y) });
  let claimed = { onTouch: false, onMove: false };
  await act(async () => {
    surface.props.onStartShouldSetResponderCapture(event(1, 200, 400));
    const onTouch = surface.props.onStartShouldSetResponder(event(1, 200, 400));
    surface.props.onMoveShouldSetResponderCapture(event(2, 200 + dx, 400 + dy));
    claimed = { onTouch, onMove: surface.props.onMoveShouldSetResponder(event(2, 200 + dx, 400 + dy)) };
    if (!claimed.onTouch && !claimed.onMove) return;
    surface.props.onResponderGrant(event(2, 200 + dx, 400 + dy));
    surface.props.onResponderMove(event(3, 200 + dx, 400 + dy));
    surface.props.onResponderRelease(event(3, 200 + dx, 400 + dy));
  });
  return claimed;
}

test('올리기 망설임의 10초 촬영(maxSec=10)이면 안내도 10초로 나온다', async () => {
  mockParams = { maxSec: '10' };
  await render(<RecordVideoScreen />);
  expect(await screen.findByText('최대 10초 · 10초가 되면 자동으로 멈춰요')).toBeOnTheScreen();
  expect(screen.queryByText('최대 5분 · 5분이 되면 자동으로 멈춰요')).not.toBeOnTheScreen();
});

test('코칭 촬영에 넘긴 대본이 있으면 카드로 띄우고, 숨김·보기를 오가며, 한 번 쓰면 비운다', async () => {
  mockParams = { mode: 'ai', next: 'upload' };
  setRecordScript({
    title: '네가 좋아하는 케이크',
    lines: [
      { kind: 'scene', speaker: null, text: '카페 앞 골목, 저녁', mine: false },
      { kind: 'dialogue', speaker: '지훈', text: '이 딸기케이크 주려고 잠깐 들른 거야.', mine: true },
    ],
  });
  await render(<RecordVideoScreen />);
  expect(await screen.findByText('대본 · 네가 좋아하는 케이크')).toBeOnTheScreen();
  expect(takeRecordScript()).toBeNull();
  expect(screen.getByText('카페 앞 골목, 저녁')).toBeOnTheScreen();
  expect(screen.getByText(/이 딸기케이크 주려고 잠깐 들른 거야\./)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('대사 숨김'));
  expect(screen.queryByText('대본 · 네가 좋아하는 케이크')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('대사 보기'));
  expect(screen.getByText('대본 · 네가 좋아하는 케이크')).toBeOnTheScreen();
});

describe('카메라·마이크 권한', () => {
  test('들어오자마자 권한을 묻고, 둘 다 허용하면 촬영 화면이 된다', async () => {
    mockCamPerm = DENIED;
    mockMicPerm = DENIED;
    mockRequestCam.mockResolvedValue(GRANTED);
    mockRequestMic.mockResolvedValue(GRANTED);

    await render(<RecordVideoScreen />);

    expect(await screen.findByLabelText('촬영 시작')).toBeOnTheScreen();
    expect(screen.getByText('최대 5분 · 5분이 되면 자동으로 멈춰요')).toBeOnTheScreen();
    expect(mockRequestCam).toHaveBeenCalledTimes(1);
    expect(mockRequestMic).toHaveBeenCalledTimes(1);
  });

  test('거절하면 화면 안에서 다시 묻고, 그때 허용하면 촬영 화면이 된다', async () => {
    mockCamPerm = DENIED;
    mockMicPerm = DENIED;
    mockRequestCam.mockResolvedValueOnce(DENIED).mockResolvedValueOnce(GRANTED);
    mockRequestMic.mockResolvedValueOnce(DENIED).mockResolvedValueOnce(GRANTED);

    await render(<RecordVideoScreen />);

    expect(await screen.findByText('카메라와 마이크가 필요해요')).toBeOnTheScreen();
    expect(screen.getByText('연기 영상을 앱에서 바로 찍으려면 카메라·마이크 권한을 켜 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '카메라·마이크 허용하기' }));

    expect(await screen.findByLabelText('촬영 시작')).toBeOnTheScreen();
    expect(mockRequestCam).toHaveBeenCalledTimes(2);
  });

  test('다시 물을 수 없게 거절했으면 설정을 연다 — 이미 허용한 마이크는 다시 묻지 않는다', async () => {
    mockCamPerm = BLOCKED;
    mockMicPerm = GRANTED;
    mockRequestCam.mockResolvedValue(BLOCKED);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    await render(<RecordVideoScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '설정 열기' }));

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestCam).toHaveBeenCalledTimes(1);
    expect(mockRequestMic).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('촬영 시작')).not.toBeOnTheScreen();
  });

  test('거절 고정 뒤 요청이 끝나지 않아도 1초 뒤 설정 열기 띠를 보인다 (10/24 안드로이드 폰)', async () => {
    jest.useFakeTimers();
    mockCamPerm = BLOCKED;
    mockMicPerm = BLOCKED;
    mockRequestCam.mockReturnValue(new Promise(() => undefined));

    await render(<RecordVideoScreen />);
    expect(screen.queryByRole('button', { name: '설정 열기' })).not.toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });

    expect(screen.getByRole('button', { name: '설정 열기' })).toBeOnTheScreen();
    jest.useRealTimers();
  });

  test('카메라만 허용돼 있으면 마이크만 묻는다', async () => {
    mockCamPerm = GRANTED;
    mockMicPerm = DENIED;
    mockRequestMic.mockResolvedValue(GRANTED);

    await render(<RecordVideoScreen />);

    expect(await screen.findByLabelText('촬영 시작')).toBeOnTheScreen();
    expect(mockRequestMic).toHaveBeenCalledTimes(1);
    expect(mockRequestCam).not.toHaveBeenCalled();
  });

  test('권한 상태를 아직 못 읽었으면 묻지 않고 뒤로만 보인다', async () => {
    mockCamPerm = null;
    mockMicPerm = null;

    await render(<RecordVideoScreen />);

    expect(screen.queryByText('카메라와 마이크가 필요해요')).not.toBeOnTheScreen();
    expect(mockRequestCam).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('기본 촬영 화면', () => {
  test('카메라 전환은 앞뒤를 오가고, 녹화 중에는 전환·닫기 대신 남은 시간을 센다', async () => {
    jest.useFakeTimers();
    mockParams = { mode: 'ai' };
    await render(<RecordVideoScreen />);

    expect(screen.getByText('camera:back')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('카메라 전환'));
    expect(screen.getByText('camera:front')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('카메라 전환'));
    expect(screen.getByText('camera:back')).toBeOnTheScreen();

    await startRecording();
    expect(mockCamera.recordAsync).toHaveBeenCalledWith({ maxDuration: 300 });
    expect(screen.getByText('5:00')).toBeOnTheScreen();
    expect(screen.queryByLabelText('카메라 전환')).not.toBeOnTheScreen();
    expect(screen.queryByText('✕')).not.toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(63_000);
    });
    expect(screen.getByText('3:57')).toBeOnTheScreen();
  });

  test('카메라가 준비되기 전에는 셔터를 받지 않고, 준비 신호가 안 와도 1.5초 뒤에는 찍을 수 있다 (iOS 제보)', async () => {
    jest.useFakeTimers();
    mockCameraReadySignal = false;
    mockParams = { mode: 'ai' };
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByLabelText('촬영 시작'));
    expect(mockCamera.recordAsync).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1_600);
    });
    await fireEvent.press(screen.getByLabelText('촬영 시작'));
    expect(mockCamera.recordAsync).toHaveBeenCalledTimes(1);
  });

  test('멈춤을 눌러도 녹화가 끝나지 않으면 4초 뒤 화면을 풀어 닫기와 다시 찍기가 되게 한다 (iOS 제보)', async () => {
    jest.useFakeTimers();
    mockCamera.stopRecording.mockImplementation(() => undefined);
    mockParams = { mode: 'ai' };
    await render(<RecordVideoScreen />);

    await startRecording();
    expect(screen.queryByText('✕')).not.toBeOnTheScreen();
    await stopRecording();
    await act(async () => {
      jest.advanceTimersByTime(4_100);
    });
    expect(await screen.findByText('촬영이 제대로 시작되지 않았어요')).toBeOnTheScreen();
    expect(screen.getByText('✕')).toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('닫기를 누르면 찍지 않고 돌아간다', async () => {
    await render(<RecordVideoScreen />);
    await fireEvent.press(screen.getByText('✕'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(peekRecordedVideo()).toBeNull();
  });

  test('준비 화면의 촬영 버튼에서 왔으면 보관함에 넣고 그 준비 화면으로 돌아간다', async () => {
    mockParams = { mode: 'ai' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(keepDeviceFile).toHaveBeenCalledWith('file:///rec.mov');
    expect(saveToLibrary).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///rec.mov', owner: 'u1' }));
    expect(takePickedVideo()).toEqual(
      expect.objectContaining({ videoId: null, pendingId: 'pend1', uri: 'file:///lib/pend1.mov', playbackUrl: null, source: 'record' }),
    );
    expect(peekRecordedVideo()).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('하단 탭에서 곧장 왔으면 보관함에 넣고 새 준비 화면을 연다', async () => {
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    expect(screen.getByText('옆으로 넘겨 용도를 바꿔요')).toBeOnTheScreen();
    await recordAndStop();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
    expect(takePickedVideo()?.pendingId).toBe('pend1');
  });

  test('코칭 탭 「지금 찍어서 코칭 받기」(next=upload)에서 왔으면 용도 줄 없이 찍고, 새 준비 화면을 첫 안내와 함께 연다', async () => {
    mockParams = { mode: 'ai', next: 'upload', first: '1' };
    await render(<RecordVideoScreen />);

    expect(screen.queryByText('옆으로 넘겨 용도를 바꿔요')).not.toBeOnTheScreen();
    await recordAndStop();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/upload', params: { first: '1' } }));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(takePickedVideo()?.pendingId).toBe('pend1');
  });

  test('보관함이 받지 않으면 이유를 알리고, 준비 화면에는 영상을 넘기지 않는다', async () => {
    saveToLibrary.mockResolvedValue({ kind: 'rejected', code: 'video_empty' });
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    expect(await screen.findByText('영상 업로드에 실패했어요. 네트워크를 확인해주세요.')).toBeOnTheScreen();
    expect(screen.getByText('영상 저장')).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('확인'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
    expect(takePickedVideo()).toBeNull();
  });

  test('기본 촬영은 보관함에 넣고 이전 화면으로 돌아간다', async () => {
    mockParams = { mode: 'plain' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(peekRecordedVideo()).toBeNull();
  });

  test('로그인 정보가 없으면 기본 촬영은 보관함에 넣지 않고 돌아간다', async () => {
    mockUser = null;
    mockParams = { mode: 'plain' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(saveToLibrary).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('로그인 정보가 없으면 AI 코칭 촬영은 영상 없이 새 준비 화면을 연다', async () => {
    mockUser = null;
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
    expect(saveToLibrary).not.toHaveBeenCalled();
    expect(takePickedVideo()).toBeNull();
    expect(peekRecordedVideo()).toBeNull();
  });

  test('용도 없이 열렸으면 찍은 영상을 핸드오프에 남기고 돌아간다', async () => {
    await render(<RecordVideoScreen />);

    await recordAndStop();

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(peekRecordedVideo()).toEqual(expect.objectContaining({ uri: 'file:///rec.mov' }));
    expect(peekRecordedVideo()?.name).toMatch(/^recording-\d+\.mov$/);
  });

  test('녹화가 결과 없이 끝나거나 실패하면 아무것도 남기지 않고 돌아간다', async () => {
    mockParams = { mode: 'plain' };
    const first = await render(<RecordVideoScreen />);
    await startRecording();
    await act(async () => finishRecording(undefined));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    await first.unmount();

    await render(<RecordVideoScreen />);
    await startRecording();
    await act(async () => failRecording(new Error('camera busy')));
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
    expect(peekRecordedVideo()).toBeNull();
    expect(saveToLibrary).not.toHaveBeenCalled();
    // 뒤로 나가는 화면은 다시 그리지 않는다(안드로이드에서 사라지는 화면을 그리면 꺼진다).
    expect(screen.queryByLabelText('촬영 시작')).not.toBeOnTheScreen();
  });

  test('촬영한 길이를 보관함에 함께 넘긴다', async () => {
    jest.useFakeTimers();
    mockParams = { mode: 'plain' };
    await render(<RecordVideoScreen />);

    await startRecording();
    await act(async () => {
      jest.advanceTimersByTime(7_000);
    });
    await stopRecording();
    await act(async () => {
      await Promise.resolve();
    });

    expect(saveToLibrary).toHaveBeenCalledWith({ uri: 'file:///rec.mov', durationMs: 7_000, owner: 'u1' });
  });
});

describe('챌린지 촬영', () => {
  const CHALLENGE = { mode: 'challenge', challengeId: 'c1', line: '나는 아직 끝나지 않았어', work: '봄날' };

  test('이미 권한이 있으면 팝업 없이 들어온 것으로 한 번 센다', async () => {
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    expect(logged('challenge_permission_result')).toEqual([{ camera: 'granted', microphone: 'granted', prompted: 'no' }]);
    expect(mockRequestCam).not.toHaveBeenCalled();
  });

  test('팝업으로 허용받았으면 그 결과만 센다', async () => {
    mockParams = CHALLENGE;
    mockCamPerm = DENIED;
    mockMicPerm = DENIED;
    mockRequestCam.mockResolvedValue(GRANTED);
    mockRequestMic.mockResolvedValue(GRANTED);

    await render(<RecordVideoScreen />);

    expect(await screen.findByLabelText('촬영 시작')).toBeOnTheScreen();
    expect(logged('challenge_permission_result')).toEqual([{ camera: 'granted', microphone: 'granted', prompted: 'yes' }]);
  });

  test('대사 카드를 띄우고, 숨김과 보기를 오가며, 카메라를 전환한다', async () => {
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    expect(screen.getByText('오늘의 대사 · 《봄날》')).toBeOnTheScreen();
    expect(screen.getByText('나는 아직 끝나지 않았어')).toBeOnTheScreen();
    expect(screen.getByText('0:00 / 1:00')).toBeOnTheScreen();
    expect(screen.getByText('최대 60초 · 촬영 후 공유할지, 저장만 할지 고를 수 있어요')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('대사 숨김'));
    expect(screen.queryByText('나는 아직 끝나지 않았어')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByText('대사 보기'));
    expect(screen.getByText('나는 아직 끝나지 않았어')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('카메라 전환'));
    expect(screen.getByText('camera:front')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('카메라 전환'));
    expect(screen.getByText('camera:back')).toBeOnTheScreen();
  });

  test('작품명이 없으면 라벨만, 대사가 없으면 카드 없이 보인다', async () => {
    mockParams = { mode: 'challenge', challengeId: 'c1', line: '대사 한 줄' };
    const first = await render(<RecordVideoScreen />);
    expect(screen.getByText('오늘의 대사')).toBeOnTheScreen();
    await first.unmount();

    mockParams = { mode: 'challenge', challengeId: 'c1' };
    await render(<RecordVideoScreen />);
    expect(screen.queryByText('오늘의 대사')).not.toBeOnTheScreen();
    expect(screen.getByText('0:00 / 1:00')).toBeOnTheScreen();
  });

  test('60초 상한으로 찍고 남은 초를 센 뒤, 챌린지 올리기로 간다', async () => {
    jest.useFakeTimers();
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    await startRecording();
    expect(mockCamera.recordAsync).toHaveBeenCalledWith({ maxDuration: 60 });
    expect(screen.getByText('60초 남음')).toBeOnTheScreen();
    expect(screen.queryByLabelText('카메라 전환')).not.toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(screen.getByText('58초 남음')).toBeOnTheScreen();
    expect(screen.getByText('0:02 / 1:00')).toBeOnTheScreen();

    await stopRecording();

    expect(logged('challenge_video_source')).toEqual([{ source: 'camera', result: 'selected' }]);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'c1', line: '나는 아직 끝나지 않았어', work: '봄날' },
    });
    expect(peekRecordedVideo()?.uri).toBe('file:///rec.mov');
  });

  test('챌린지 올리기로 넘어간 뒤에는 떠나는 촬영 화면을 다시 그리지 않는다 (안드로이드 꺼짐 방지)', async () => {
    jest.useFakeTimers();
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    await startRecording();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    await stopRecording();

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    // 녹화 표시를 그대로 두고(카메라 전환이 다시 나타나지 않음), 남은 시간도 더 세지 않는다.
    expect(screen.queryByLabelText('카메라 전환')).not.toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(screen.getByText('58초 남음')).toBeOnTheScreen();
  });

  test('챌린지 대사 없이 챌린지 촬영을 마치면 대사 고르기로 간다', async () => {
    mockParams = { mode: 'challenge' };
    await render(<RecordVideoScreen />);

    await recordAndStop();

    expect(mockRouter.replace).toHaveBeenCalledWith('/line-pick');
  });

  test('녹화가 결과 없이 끝나거나 실패하면 실패로 세고 돌아간다', async () => {
    mockParams = CHALLENGE;
    const first = await render(<RecordVideoScreen />);
    await startRecording();
    await act(async () => finishRecording({}));
    await first.unmount();

    await render(<RecordVideoScreen />);
    await startRecording();
    await act(async () => failRecording(new Error('camera busy')));

    expect(logged('challenge_video_source')).toEqual([
      { source: 'camera', result: 'failed' },
      { source: 'camera', result: 'failed' },
    ]);
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('닫기는 찍지 않고 돌아간다', async () => {
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);
    const buttons = screen.getAllByRole('button');
    await fireEvent.press(buttons[0]);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('업로드에서 고르지 않고 닫으면 취소로 세고 화면에 머문다', async () => {
    mockParams = CHALLENGE;
    launchPicker.mockResolvedValue({ canceled: true, assets: null });
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByText('업로드'));

    expect(launchPicker).toHaveBeenCalledWith({ mediaTypes: ['videos'], allowsEditing: false, preferredAssetRepresentationMode: 'current' });
    expect(logged('challenge_video_source')).toEqual([{ source: 'gallery', result: 'cancelled' }]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(peekRecordedVideo()).toBeNull();
  });

  test('업로드에서 고른 영상은 길이·이름을 정리해 챌린지 올리기로 넘긴다', async () => {
    mockParams = CHALLENGE;
    launchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///clip.mp4', duration: 12_345.6, fileName: 'clip.mp4' }] });
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByText('업로드'));

    expect(logged('challenge_video_source')).toEqual([{ source: 'gallery', result: 'selected' }]);
    expect(keepDeviceFile).toHaveBeenCalledWith('file:///clip.mp4');
    expect(peekRecordedVideo()).toEqual({ uri: 'file:///clip.mp4', durationMs: 12_346, name: 'clip.mp4', source: 'gallery' });
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'c1', line: '나는 아직 끝나지 않았어', work: '봄날' },
    });
  });

  test('길이·이름이 없는 영상은 길이 없이 기본 이름으로 넘기고, 두 번 골라도 한 번만 넘긴다', async () => {
    mockParams = CHALLENGE;
    launchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///clip2.mp4', duration: null, fileName: null }] });
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByText('업로드'));
    await fireEvent.press(screen.getByText('업로드'));

    expect(peekRecordedVideo()?.durationMs).toBeNull();
    expect(peekRecordedVideo()?.name).toMatch(/^video-\d+\.mp4$/);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });

  test('업로드에서 이미 골랐으면 이어서 끝난 녹화는 다시 넘기지 않는다', async () => {
    mockParams = CHALLENGE;
    launchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///clip.mp4', duration: 5_000, fileName: 'clip.mp4' }] });
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByText('업로드'));
    await recordAndStop();

    expect(peekRecordedVideo()?.uri).toBe('file:///clip.mp4');
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(keepDeviceFile).toHaveBeenCalledTimes(1);
  });

  test('3초 미만 촬영본을 올리기 화면이 막을 수 있게 찍은 길이를 넘긴다', async () => {
    jest.useFakeTimers();
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    await startRecording();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    await stopRecording();

    expect(peekRecordedVideo()?.durationMs).toBe(2_000);
  });

  test('상한에서 네이티브가 멈추면 카메라가 켜지는 지연이 있어도 길이를 상한으로 넘긴다', async () => {
    jest.useFakeTimers();
    mockParams = CHALLENGE;
    await render(<RecordVideoScreen />);

    await startRecording();
    await act(async () => {
      jest.advanceTimersByTime(60_400);
    });
    await act(async () => finishRecording({ uri: 'file:///rec.mov' }));

    expect(peekRecordedVideo()?.durationMs).toBe(60_000);
  });
});

describe('용도 고르기(하단 탭에서 곧장 연 촬영)', () => {
  test('용도를 고르지 않았으면 AI 코칭이 골라져 있고, 그냥 촬영을 누르면 찍은 뒤 영상 화면으로 간다', async () => {
    mockParams = { picker: '1' };
    await render(<RecordVideoScreen />);

    expect(screen.getByRole('tab', { name: 'AI 코칭', selected: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'AI 코칭' }));
    await fireEvent.press(screen.getByRole('tab', { name: '그냥 촬영' }));
    expect(screen.getByRole('tab', { name: '그냥 촬영', selected: true })).toBeOnTheScreen();

    await recordAndStop();

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(listChallenges).not.toHaveBeenCalled();
  });

  test('오늘의 대사를 고르면 그날의 챌린지를 불러오는 동안 안내하고, 대사 카드를 띄운다', async () => {
    let resolveList: (value: unknown) => void = () => undefined;
    listChallenges.mockImplementation(() => new Promise((resolve) => (resolveList = resolve)));
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: '오늘의 대사' }));
    expect(screen.getByText('오늘의 대사를 불러오는 중이에요')).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenCalledWith({ tab: 'popular' });

    await swipe(-120);
    expect(listChallenges).toHaveBeenCalledTimes(1);

    await act(async () => resolveList({ featured: { id: 'c9', line: '오늘 대사', work: '작품' } }));

    expect(screen.getByText('오늘 대사')).toBeOnTheScreen();
    expect(screen.getByText('오늘의 대사 · 《작품》')).toBeOnTheScreen();
    expect(screen.queryByText('오늘의 대사를 불러오는 중이에요')).not.toBeOnTheScreen();

    await recordAndStop();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'c9', line: '오늘 대사', work: '작품' },
    });
  });

  test('오늘의 대사가 없거나 못 불러오면 지금 용도에 머문다', async () => {
    listChallenges.mockResolvedValueOnce({ featured: null }).mockRejectedValueOnce(new Error('down'));
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: '오늘의 대사' }));
    expect(screen.getByRole('tab', { name: 'AI 코칭', selected: true })).toBeOnTheScreen();
    expect(screen.queryByText('오늘의 대사를 불러오는 중이에요')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: '오늘의 대사' }));
    expect(screen.getByRole('tab', { name: 'AI 코칭', selected: true })).toBeOnTheScreen();
    expect(listChallenges).toHaveBeenCalledTimes(2);
  });

  test('오늘의 대사가 없으면 챌린지 탭에서 고르라고 안내한다', async () => {
    listChallenges.mockResolvedValue({ featured: null });
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    await fireEvent.press(screen.getByRole('tab', { name: '오늘의 대사' }));

    expect(await screen.findByText('오늘의 대사가 아직 없어요. 챌린지 탭에서 대사를 골라 주세요.')).toBeOnTheScreen();
  });

  test('화면을 왼쪽으로 충분히 넘기면 다음 용도로, 오른쪽으로 넘기면 이전 용도로 간다', async () => {
    mockParams = { picker: '1', challengeId: 'c1', line: '대사', work: '작품' };
    await render(<RecordVideoScreen />);

    await swipe(-30);
    expect(screen.getByRole('tab', { name: 'AI 코칭', selected: true })).toBeOnTheScreen();

    await swipe(-120);
    expect(screen.getByRole('tab', { name: '오늘의 대사', selected: true })).toBeOnTheScreen();
    expect(screen.getByText('대사')).toBeOnTheScreen();

    await swipe(120);
    expect(screen.getByRole('tab', { name: 'AI 코칭', selected: true })).toBeOnTheScreen();
    expect(listChallenges).not.toHaveBeenCalled();
  });

  test('닿으면 넘기기 자리가 받고, 움직임은 가로로 충분히 움직였을 때만 가로챈다', async () => {
    listChallenges.mockResolvedValue({ featured: null });
    mockParams = { mode: 'ai', picker: '1' };
    await render(<RecordVideoScreen />);

    expect(await swipe(10, 300)).toEqual({ onTouch: true, onMove: false });
    expect(await swipe(30, 100)).toEqual({ onTouch: true, onMove: false });
    expect(await swipe(-120, 10)).toEqual({ onTouch: true, onMove: true });
  });

  test('녹화 중에는 넘겨도 용도가 바뀌지 않는다', async () => {
    mockParams = { mode: 'ai', picker: '1', challengeId: 'c1', line: '대사', work: '작품' };
    await render(<RecordVideoScreen />);

    await startRecording();
    await swipe(-120);
    await stopRecording();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
    expect(screen.queryByText('대사')).not.toBeOnTheScreen();
  });

  test('하단 탭에서 오지 않았으면 넘기기를 받지 않는다', async () => {
    mockParams = { mode: 'ai' };
    await render(<RecordVideoScreen />);

    expect(await swipe(-120)).toEqual({ onTouch: false, onMove: false });
    expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
  });
});
