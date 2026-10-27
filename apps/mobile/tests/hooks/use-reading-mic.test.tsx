import { act, renderHook } from '@testing-library/react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import { Platform } from 'react-native';

import { hasMicPermission, micPermissionGranted, micPermissionState, requestMicPermission, useReadingMic } from '@/hooks/use-reading-mic';
import type { VadEvent } from '@/lib/reading/vad';

const mockRecorder = {
  uri: 'file:///rec.m4a' as string | null,
  metering: -80 as number | undefined,
  durationMillis: 2300 as number | undefined,
  statusFails: false,
  getStatus: jest.fn(() => {
    if (mockRecorder.statusFails) throw new Error('released');
    return { metering: mockRecorder.metering, durationMillis: mockRecorder.durationMillis };
  }),
  prepareToRecordAsync: jest.fn(async () => undefined),
  record: jest.fn(),
  stop: jest.fn(async () => undefined),
};
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  useAudioRecorder: () => mockRecorder,
}));

const permission = (granted: boolean, canAskAgain = true) => ({ granted, canAskAgain, status: granted ? 'granted' : 'denied', expires: 'never' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.assign(mockRecorder, { uri: 'file:///rec.m4a', metering: -80, durationMillis: 2300, statusFails: false });
  jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(true));
});

afterEach(() => {
  jest.useRealTimers();
});

async function openMic() {
  const events: VadEvent[] = [];
  const hook = await renderHook(() => useReadingMic());
  let opened = false;
  await act(async () => {
    opened = await hook.result.current.start((event) => events.push(event));
  });
  return { hook, events, opened };
}

async function sound(db: number, ms: number) {
  mockRecorder.metering = db;
  await act(async () => jest.advanceTimersByTime(ms));
}

describe('hasMicPermission', () => {
  test('이미 허락했으면 묻지 않고 true', async () => {
    expect(await hasMicPermission()).toBe(true);
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  test('아직 안 물었으면 OS 팝업의 답을 따른다', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false));
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce(permission(true)).mockResolvedValueOnce(permission(false));

    expect(await hasMicPermission()).toBe(true);
    expect(await hasMicPermission()).toBe(false);
  });

  test('거절해서 다시 물을 수 없으면 요청이 바로 거절로 돌아와 false', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false, false));
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(permission(false, false));

    expect(await hasMicPermission()).toBe(false);
  });

  // 안드로이드에서 「이번만 허용」이 끝나면 조회는 canAskAgain=false 지만 요청하면 OS 창이 다시 뜬다(10/28 폰 확인).
  test('조회가 다시 못 묻는다고 해도 한 번은 요청하고 허용하면 true', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false, false));
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(permission(true));

    expect(await hasMicPermission()).toBe(true);
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('권한을 읽지 못하면 false', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockRejectedValue(new Error('no module'));
    expect(await hasMicPermission()).toBe(false);
  });
});

describe('requestMicPermission · micPermissionState', () => {
  const originalOS = Platform.OS;
  afterEach(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

  test('조회가 다시 못 묻는다고 해도 요청해 허용하면 granted, 정말 막혔으면 blocked', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false, false));
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce(permission(true)).mockResolvedValueOnce(permission(false, false));

    expect(await requestMicPermission()).toBe('granted');
    expect(await requestMicPermission()).toBe('blocked');
  });

  test('안드로이드는 조회만으로 blocked 라고 하지 않고 ask 로 둔다', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false, false));
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    expect(await micPermissionState()).toBe('ask');
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    expect(await micPermissionState()).toBe('blocked');
  });
});

describe('micPermissionGranted', () => {
  test('지금 권한만 본다', async () => {
    expect(await micPermissionGranted()).toBe(true);
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false));
    expect(await micPermissionGranted()).toBe(false);
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  test('권한을 읽지 못하면 false', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockRejectedValue(new Error('no module'));
    expect(await micPermissionGranted()).toBe(false);
  });
});

describe('useReadingMic', () => {
  test('말하다가 1.8초 조용하면 말 시작과 말 끝을 알린다', async () => {
    const { events, opened } = await openMic();
    expect(opened).toBe(true);
    expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledWith({ extension: '.m4a', isMeteringEnabled: true });

    await sound(-10, 600);
    expect(events).toEqual(['speech_start']);
    await sound(-80, 1900);
    expect(events).toEqual(['speech_start', 'speech_end']);
  });

  test('아주 짧은 소리는 말로 치지 않는다', async () => {
    const { events } = await openMic();

    await sound(-10, 100);
    await sound(-80, 2000);
    expect(events).toEqual(['speech_start']);
  });

  test('60초 동안 아무 말이 없으면 시간 초과를 알린다', async () => {
    const { events } = await openMic();

    await sound(-80, 60_050);
    expect(events).toEqual(['timeout']);
  });

  test('미터링을 읽지 못하면 조용한 것으로 본다', async () => {
    const { events } = await openMic();
    mockRecorder.statusFails = true;

    await sound(-10, 1000);
    expect(events).toEqual([]);
  });

  test('닫으면 녹음 파일과 길이를 돌려주고, 이미 닫혔으면 null', async () => {
    const { hook } = await openMic();

    await expect(hook.result.current.stop()).resolves.toEqual({ uri: 'file:///rec.m4a', durationMs: 2300 });
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    await expect(hook.result.current.stop()).resolves.toBeNull();
  });

  test('닫은 뒤에는 침묵 감지를 멈춘다', async () => {
    const { hook, events } = await openMic();
    await act(async () => {
      await hook.result.current.stop();
    });

    await sound(-10, 1000);
    expect(events).toEqual([]);
  });

  test('녹음기를 멈추다 실패하면 파일 없이 길이만 돌려준다', async () => {
    const { hook } = await openMic();
    mockRecorder.stop.mockRejectedValueOnce(new Error('not recording'));

    await expect(hook.result.current.stop()).resolves.toEqual({ uri: null, durationMs: 2300 });
  });

  test('길이를 읽지 못하면 0 으로 돌려준다', async () => {
    const { hook } = await openMic();
    mockRecorder.statusFails = true;
    mockRecorder.uri = null;

    await expect(hook.result.current.stop()).resolves.toEqual({ uri: null, durationMs: 0 });
  });

  test('길이가 없으면 0 으로 돌려준다', async () => {
    const { hook } = await openMic();
    mockRecorder.durationMillis = undefined;

    await expect(hook.result.current.stop()).resolves.toEqual({ uri: 'file:///rec.m4a', durationMs: 0 });
  });

  test('권한이 없으면 열지 않는다', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(permission(false));
    const { opened, hook } = await openMic();

    expect(opened).toBe(false);
    expect(mockRecorder.record).not.toHaveBeenCalled();
    await expect(hook.result.current.stop()).resolves.toBeNull();
  });

  test('녹음기를 준비하지 못하면 열지 않는다', async () => {
    mockRecorder.prepareToRecordAsync.mockRejectedValueOnce(new Error('busy'));
    const { opened } = await openMic();

    expect(opened).toBe(false);
  });

  test('열려 있는데 다시 열면 앞 녹음을 닫고 새로 연다', async () => {
    const { hook } = await openMic();

    await act(async () => {
      await hook.result.current.start(() => undefined);
    });
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(mockRecorder.record).toHaveBeenCalledTimes(2);
  });

  test('훅이 사라지면 마이크를 닫는다', async () => {
    const { hook } = await openMic();

    await hook.unmount();
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  });
});
