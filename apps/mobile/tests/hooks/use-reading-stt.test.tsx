import { act, renderHook } from '@testing-library/react-native';
import { setAudioModeAsync } from 'expo-audio';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { detectSttPolicy, SPEECH_END_GRACE_MS, sttCanPersist, sttVolumeToRms, useReadingStt } from '@/hooks/use-reading-stt';
import type { VadEvent } from '@/lib/reading/vad';

type Handler = (event?: unknown) => void;
const mockHandlers: Record<string, Handler> = {};
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    supportsRecording: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: (name: string, handler: Handler) => {
    mockHandlers[name] = handler;
  },
}));
jest.mock('expo-file-system', () => ({ Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => undefined) }));

const recognizer = jest.mocked(ExpoSpeechRecognitionModule);
const permission = (granted: boolean, canAskAgain = true) => ({ granted, canAskAgain, status: granted ? 'granted' : 'denied', expires: 'never' }) as never;
const emit = async (name: string, event?: unknown) => act(async () => mockHandlers[name]?.(event));
const result = (transcript: string, isFinal = false) => ({ isFinal, results: [{ transcript, confidence: 1, segments: [] }] });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  recognizer.isRecognitionAvailable.mockReturnValue(true);
  recognizer.getPermissionsAsync.mockResolvedValue(permission(true));
  recognizer.supportsRecording.mockReturnValue(true);
  recognizer.start.mockImplementation(() => undefined);
  recognizer.stop.mockImplementation(() => undefined);
  recognizer.abort.mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

async function listen(options?: { persist?: boolean }) {
  const events: VadEvent[] = [];
  const interim: string[] = [];
  const hook = await renderHook(() => useReadingStt());
  let started = false;
  await act(async () => {
    started = hook.result.current.start({ onEvent: (e) => events.push(e), onInterim: (t) => interim.push(t) }, options);
  });
  return { stt: hook.result.current, events, interim, started, hook };
}

test('인식기 음량을 침묵 감지기가 아는 0~1 로 바꾼다', () => {
  expect(sttVolumeToRms(-2)).toBe(0);
  expect(sttVolumeToRms(0)).toBe(0);
  expect(sttVolumeToRms(2)).toBeCloseTo(0.115);
  expect(sttVolumeToRms(30)).toBe(1);
});

describe('detectSttPolicy', () => {
  test('인식기가 있고 권한이 있으면 켠다', async () => {
    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'stt' });
    expect(recognizer.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('아직 안 물었으면 묻고 그 답을 따른다', async () => {
    recognizer.getPermissionsAsync.mockResolvedValue(permission(false));
    recognizer.requestPermissionsAsync.mockResolvedValueOnce(permission(true)).mockResolvedValueOnce(permission(false));

    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'stt' });
    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'typing', reason: 'denied' });
  });

  test('다시 물을 수 없게 거절했으면 끈다', async () => {
    recognizer.getPermissionsAsync.mockResolvedValue(permission(false, false));

    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'typing', reason: 'denied' });
    expect(recognizer.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('인식기가 없거나 확인이 실패하면 쓸 수 없다고 본다', async () => {
    recognizer.isRecognitionAvailable.mockReturnValueOnce(false);
    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'typing', reason: 'unavailable' });

    recognizer.getPermissionsAsync.mockRejectedValueOnce(new Error('no module'));
    await expect(detectSttPolicy()).resolves.toEqual({ kind: 'typing', reason: 'unavailable' });
  });
});

test('인식기 녹음 지원은 모듈 답을 따르고, 확인이 실패하면 없다고 본다', () => {
  expect(sttCanPersist()).toBe(true);
  recognizer.supportsRecording.mockReturnValueOnce(false);
  expect(sttCanPersist()).toBe(false);
  recognizer.supportsRecording.mockImplementationOnce(() => {
    throw new Error('old android');
  });
  expect(sttCanPersist()).toBe(false);
});

describe('useReadingStt', () => {
  test('앱 말로 연속 인식을 켜고, persist 면 들은 소리를 캐시에 wav 로 남기게 한다', async () => {
    const { started, stt } = await listen({ persist: true });

    expect(started).toBe(true);
    const options = recognizer.start.mock.calls[0][0];
    expect(options).toEqual({
      lang: 'ko-KR',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 50 },
      iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'default' },
      recordingOptions: { persist: true, outputDirectory: 'file:///cache/', outputFileName: expect.stringMatching(/^reading-line-\d+\.wav$/) },
    });
    expect(stt.canPersist()).toBe(true);
  });

  test('녹음을 남길 수 없는 기기는 persist 를 달라고 해도 남기지 않는다', async () => {
    recognizer.supportsRecording.mockReturnValue(false);
    await listen({ persist: true });

    expect(recognizer.start.mock.calls[0][0]).not.toHaveProperty('recordingOptions');
  });

  test('인식기를 켜지 못하면 false', async () => {
    recognizer.start.mockImplementation(() => {
      throw new Error('busy');
    });
    const { started, events } = await listen();

    expect(started).toBe(false);
    await act(async () => jest.advanceTimersByTime(61_000));
    expect(events).toEqual([]);
  });

  test('중간 결과를 알리고, 끝내면 마지막으로 알아들은 글을 돌려준다', async () => {
    const { stt, interim } = await listen();

    await emit('result', result(' 오늘 '));
    await emit('result', result(''));
    await emit('result', result('오늘 왔구나'));
    expect(interim).toEqual(['오늘', '오늘 왔구나']);

    let said = '';
    await act(async () => {
      const pending = stt.finish();
      mockHandlers.result(result('오늘 왔구나.', true));
      mockHandlers.end();
      said = await pending;
    });
    expect(said).toBe('오늘 왔구나.');
    expect(recognizer.stop).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: true, allowsRecording: false }));
  });

  test('멈춘 뒤 앞 구간의 확정이 먼저 와도 끝(end)까지 기다려 마지막 구간까지 담는다(SOMA-646)', async () => {
    const { stt } = await listen();
    await emit('result', result('그래서 더 말하기 싫었어'));
    await emit('result', result('네가 그걸'));

    let said = '';
    let settled = false;
    await act(async () => {
      const pending = stt.finish().then((t) => {
        settled = true;
        return t;
      });
      mockHandlers.result(result('그래서 더 말하기 싫었어', true));
      await Promise.resolve();
      expect(settled).toBe(false);
      mockHandlers.result(result('네가 그걸 아니까', true));
      mockHandlers.end();
      said = await pending;
    });
    expect(said).toBe('그래서 더 말하기 싫었어 네가 그걸 아니까');
  });

  test('말을 마치자마자 멈춰 마지막 구간의 확정 없이 오류로 끝나도 그 구간의 중간 결과를 남긴다(expo-speech-recognition #158)', async () => {
    const { stt } = await listen();
    await emit('result', result('그래서 더 말하기 싫었어', true));
    await emit('result', result('네가 그걸 아니까'));

    let said = '';
    await act(async () => {
      const pending = stt.finish();
      mockHandlers.result(result(''));
      mockHandlers.error({ error: 'client' });
      mockHandlers.end();
      said = await pending;
    });
    expect(said).toBe('그래서 더 말하기 싫었어 네가 그걸 아니까');
  });

  test('인식기가 끝(end)을 알리면 그때까지의 글로 끝난다', async () => {
    const { stt } = await listen();
    await emit('result', result('괜찮아'));

    let said = '';
    await act(async () => {
      const pending = stt.finish();
      mockHandlers.end();
      said = await pending;
    });
    expect(said).toBe('괜찮아');
  });

  test('인식기 오류도 그때까지의 글로 끝낸다', async () => {
    const { stt } = await listen();
    await emit('result', result('응'));

    let said = '';
    await act(async () => {
      const pending = stt.finish();
      mockHandlers.error({ error: 'network' });
      said = await pending;
    });
    expect(said).toBe('응');
  });

  test('인식기가 아무 답도 없으면 2.5초 뒤에 스스로 끝낸다', async () => {
    const { stt } = await listen();
    await emit('result', result('사이'));

    let said = '';
    await act(async () => {
      const pending = stt.finish();
      jest.advanceTimersByTime(2_500);
      said = await pending;
    });
    expect(said).toBe('사이');
  });

  test('인식기를 멈추다 실패하면 바로 끝낸다', async () => {
    recognizer.stop.mockImplementation(() => {
      throw new Error('not running');
    });
    const { stt } = await listen();

    await expect(stt.finish()).resolves.toBe('');
  });

  test('SOMA-597: 인식기가 스스로 끝나면 onEnd 를 한 번 알리고, 끝내기·끊기로 멈춘 끝에는 알리지 않는다', async () => {
    const hook = await renderHook(() => useReadingStt());
    const ends: string[] = [];
    const listener = { onEvent: () => undefined, onInterim: () => undefined, onEnd: () => ends.push('end') };
    await act(async () => {
      hook.result.current.start(listener);
    });
    await emit('result', result('그래서 더 말하기 싫었어'));
    await emit('end');
    await emit('error');
    expect(ends).toEqual(['end']);
    await expect(hook.result.current.finish()).resolves.toBe('그래서 더 말하기 싫었어');

    await act(async () => {
      hook.result.current.start(listener);
    });
    await act(async () => {
      const pending = hook.result.current.finish();
      mockHandlers.end();
      await pending;
    });
    await act(async () => {
      hook.result.current.start(listener);
      hook.result.current.abort();
    });
    await emit('end');
    expect(ends).toEqual(['end']);
  });

  test('듣고 있지 않을 때 끝내면 마지막 글을 바로 돌려준다', async () => {
    const hook = await renderHook(() => useReadingStt());

    await expect(hook.result.current.finish()).resolves.toBe('');
    expect(recognizer.stop).not.toHaveBeenCalled();
  });

  test('듣기 전이나 끝난 뒤의 사건은 무시한다', async () => {
    const { stt, interim, events } = await listen();
    await act(async () => {
      stt.abort();
    });

    await emit('result', result('늦은 결과'));
    await emit('volumechange', { value: 8 });
    await emit('speechstart');
    await emit('end');
    expect(interim).toEqual([]);
    expect(events).toEqual([]);
  });

  test('음량으로 말 시작과 1.8초 침묵 뒤 말 끝을 알린다', async () => {
    const { events } = await listen();

    await emit('volumechange', { value: 6 });
    await act(async () => jest.advanceTimersByTime(600));
    await emit('volumechange', { value: -2 });
    await act(async () => jest.advanceTimersByTime(1_900));
    expect(events).toEqual(['speech_start', 'speech_end']);
  });

  test('인식기가 말 끝을 알리면 조금 더 기다렸다가 넘기고, 그사이 다시 말하면 취소한다', async () => {
    const { events } = await listen();
    await emit('result', result('오늘'));

    await emit('speechend');
    await emit('speechstart');
    await act(async () => jest.advanceTimersByTime(SPEECH_END_GRACE_MS));
    expect(events).toEqual(['speech_start']);

    await emit('speechend');
    await emit('speechend');
    await act(async () => jest.advanceTimersByTime(SPEECH_END_GRACE_MS));
    expect(events).toEqual(['speech_start', 'speech_end']);
  });

  test('문장부호·말줄임표·추임새가 든 받아쓰기도 말 끝에 넘긴다 — 넘김은 글을 대본과 견주지 않는다(SOMA-646)', async () => {
    const { events } = await listen();
    await emit('result', result('진짜?! ㅋㅋㅋ… 그래서요...'));

    await emit('speechend');
    await act(async () => jest.advanceTimersByTime(SPEECH_END_GRACE_MS));
    expect(events).toEqual(['speech_end']);
  });

  test('받아쓴 글이 없는 말 끝은 잡음으로 보고 넘기지 않는다', async () => {
    const { events } = await listen();

    await emit('speechend');
    await act(async () => jest.advanceTimersByTime(SPEECH_END_GRACE_MS));
    expect(events).toEqual([]);
  });

  test('듣는 중에 끊으면 인식기를 끊고 오디오를 되돌린다', async () => {
    const { stt } = await listen();

    await act(async () => stt.abort());
    expect(recognizer.abort).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);

    await act(async () => stt.abort());
    expect(recognizer.abort).toHaveBeenCalledTimes(1);
  });

  test('인식기를 끊다 실패해도 오디오는 되돌린다', async () => {
    recognizer.abort.mockImplementation(() => {
      throw new Error('gone');
    });
    const { stt } = await listen();

    await act(async () => stt.abort());
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  test('끝낸 줄의 녹음은 인식기가 파일을 다 쓴(audioend) 뒤 그 파일로 떼어 낸다', async () => {
    const { stt } = await listen({ persist: true });

    let uri: string | null = null;
    await act(async () => {
      const pending = stt.finish();
      mockHandlers.end();
      await pending;
      const detached = stt.detachRecording();
      mockHandlers.audioend({ uri: 'file:///cache/reading-line-1.wav' });
      uri = await detached;
    });
    expect(uri).toBe('file:///cache/reading-line-1.wav');
  });

  test('끝나지 않고 닫힌 줄의 조각 파일을 넘겨 지우게 한다', async () => {
    const { stt } = await listen({ persist: true });
    await emit('audioend', { uri: 'file:///cache/partial.wav' });

    expect(stt.takeRecordingUri()).toBe('file:///cache/partial.wav');
    expect(stt.takeRecordingUri()).toBeNull();
  });

  test('녹음을 남기지 않은 줄은 떼어 낼 녹음이 없다', async () => {
    const { stt } = await listen();
    await emit('audioend');

    await expect(stt.detachRecording()).resolves.toBeNull();
  });

  test('결과가 비어 오면 알리지 않는다', async () => {
    const { interim } = await listen();

    await emit('result', { isFinal: false, results: [] });
    expect(interim).toEqual([]);
  });

  test('끊은 뒤 온 인식기의 말 끝은 무시한다', async () => {
    const { stt, events } = await listen();
    await emit('result', result('오늘'));
    await act(async () => stt.abort());

    await emit('speechend');
    await act(async () => jest.advanceTimersByTime(SPEECH_END_GRACE_MS));
    expect(events).toEqual([]);
  });

  test('인식기가 먼저 끝났으면 2.5초 안전장치는 다시 끝내지 않는다', async () => {
    const { stt } = await listen();

    await act(async () => {
      const pending = stt.finish();
      mockHandlers.end();
      await pending;
    });
    await act(async () => jest.advanceTimersByTime(2_500));
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
  });
});
