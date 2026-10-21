import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';

import ReadingPlay from '@/app/reading/play';
import { hasMicPermission, micPermissionGranted } from '@/hooks/use-reading-mic';
import { detectSttPolicy } from '@/hooks/use-reading-stt';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { currentNetworkType } from '@/lib/reading/network';
import { deleteDeviceFile } from '@/lib/account-files';
import { enqueueLineRecording, onRecordingQueueChange, pendingRecordingUploads } from '@/lib/reading/recording-runner';
import { getLastRunReview, resetReadingState, setCurrentSession, updateCurrent } from '@/lib/reading/store';
import { takeContinueOrigin } from '@/lib/practice/session-state';
import { missingModelBytes, removeDownloadedAssets } from '@/lib/reading/tts/assets';
import { hasDeviceVoice, speakWithDevice } from '@/lib/reading/tts/device-voice';
import * as tts from '@/lib/reading/tts/engine';
import { VoicePrepareError } from '@/lib/reading/tts/voice-errors';
import type { SessionDetail } from '@/lib/reading/types';
import type { VadEvent } from '@/lib/reading/vad';
import { currentTutorial, startTutorial } from '@/lib/tutorial';

import { closeModalOf, openFixtureScript, scriptDetail, sessionDetail, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn() };
const mockRemoveListeners: (() => void)[] = [];
const mockNavigation = {
  addListener: jest.fn((event: string, fn: () => void) => {
    if (event === 'beforeRemove') mockRemoveListeners.push(fn);
    return () => undefined;
  }),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useNavigation: () => mockNavigation }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(async () => undefined) }));
jest.mock('@/lib/api', () => ({ api: { getCloudVoiceStatus: jest.fn() } }));
const mockAskRating = jest.fn(async () => undefined);
jest.mock('@/hooks/use-app-rating', () => ({ useAppRating: () => ({ after: mockAskRating, element: null }) }));

type Listener = { onEvent: (event: VadEvent) => void; onInterim?: (text: string) => void };
const mockMic = { start: jest.fn(), stop: jest.fn() };
const mockStt = {
  start: jest.fn(),
  finish: jest.fn(),
  abort: jest.fn(),
  detachRecording: jest.fn(),
  canPersist: jest.fn(),
  takeRecordingUri: jest.fn(),
};
jest.mock('@/hooks/use-reading-mic', () => ({
  hasMicPermission: jest.fn(),
  micPermissionGranted: jest.fn(),
  useReadingMic: () => mockMic,
}));
jest.mock('@/hooks/use-reading-stt', () => ({ detectSttPolicy: jest.fn(), useReadingStt: () => mockStt }));
jest.mock('@/lib/reading/tts/engine', () => ({
  createQueueFor: jest.fn(),
  play: jest.fn(),
  speak: jest.fn(),
  stop: jest.fn(),
  ensureReady: jest.fn(),
  isReady: jest.fn(),
}));
jest.mock('@/lib/reading/tts/assets', () => ({
  activeVariant: () => 'fp32',
  missingModelBytes: jest.fn(),
  modelDownloadBytes: () => 400 * 1024 * 1024,
  removeDownloadedAssets: jest.fn(),
}));
jest.mock('@/lib/reading/tts/device-voice', () => ({
  hasDeviceVoice: jest.fn(),
  speakWithDevice: jest.fn(),
  stopDeviceVoice: jest.fn(),
}));
jest.mock('@/lib/reading/network', () => ({ currentNetworkType: jest.fn() }));
jest.mock('@/lib/reading/cloud-voice-runtime', () => ({ synthesizeCloudSpeech: jest.fn() }));
jest.mock('@/lib/reading/recording-runner', () => ({
  enqueueLineRecording: jest.fn(),
  onRecordingQueueChange: jest.fn(() => () => undefined),
  pendingRecordingUploads: jest.fn(),
}));
jest.mock('@/lib/account-files', () => ({ deleteDeviceFile: jest.fn(async () => undefined) }));
const mockFileOps: string[][] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    copy(dest: { uri: string }) {
      mockFileOps.push(['copy', this.uri, dest.uri]);
    }
    delete() {
      mockFileOps.push(['delete', this.uri]);
    }
  },
}));

const queue = { prime: jest.fn(), first: jest.fn(), take: jest.fn(), cancel: jest.fn() };
let mic: Listener | null = null;
let recognizer: Listener | null = null;
let appStateListeners: ((state: string) => void)[] = [];

const ME = '민재 · 내 차례';

beforeEach(async () => {
  jest.clearAllMocks();
  mockRemoveListeners.length = 0;
  mockFileOps.length = 0;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('acttub.reading.autoAdvanceTipHidden', '1');
  mic = null;
  recognizer = null;
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListeners.push(fn as (state: string) => void);
    return { remove: () => (appStateListeners = appStateListeners.filter((l) => l !== fn)) } as never;
  });
  jest.mocked(hasMicPermission).mockResolvedValue(true);
  jest.mocked(micPermissionGranted).mockResolvedValue(true);
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'typing', reason: 'unavailable' });
  jest.mocked(api.getCloudVoiceStatus).mockRejectedValue(new Error('offline'));
  jest.mocked(hasDeviceVoice).mockResolvedValue(true);
  jest.mocked(speakWithDevice).mockResolvedValue(undefined);
  jest.mocked(missingModelBytes).mockReturnValue(0);
  jest.mocked(currentNetworkType).mockResolvedValue('wifi');
  jest.mocked(tts.ensureReady).mockResolvedValue(undefined);
  jest.mocked(tts.isReady).mockReturnValue(true);
  jest.mocked(tts.play).mockResolvedValue(undefined);
  jest.mocked(tts.speak).mockResolvedValue(undefined);
  jest.mocked(tts.createQueueFor).mockReturnValue(queue as never);
  queue.first.mockResolvedValue(undefined);
  queue.take.mockResolvedValue('file:///speech.wav');
  mockMic.start.mockImplementation(async (onEvent: Listener['onEvent']) => {
    mic = { onEvent };
    return true;
  });
  mockMic.stop.mockResolvedValue({ uri: 'file:///turn.m4a', durationMs: 1500 });
  mockStt.start.mockImplementation((listener: Listener) => {
    recognizer = listener;
    return true;
  });
  mockStt.finish.mockResolvedValue('');
  mockStt.detachRecording.mockResolvedValue('file:///turn.wav');
  mockStt.canPersist.mockReturnValue(true);
  mockStt.takeRecordingUri.mockReturnValue(null);
  jest.mocked(enqueueLineRecording).mockResolvedValue({ kind: 'queued' });
  jest.mocked(pendingRecordingUploads).mockResolvedValue(0);
});

/** 준비가 끝나면 「리딩 시작 전」에 멈춘다 — [시작]을 눌러 첫 줄을 연다(SOMA-772). */
async function begin() {
  await fireEvent.press(await screen.findByText('시작'));
}

/** 완료 화면 버튼은 뜬 직후 잠깐 막혀 있다(SOMA-772) — 풀린 뒤 누른다. */
async function pressWhenReady(label: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled(), { timeout: 2000 });
  await fireEvent.press(screen.getByRole('button', { name: label }));
}

async function startPlay(over: Partial<SessionDetail> = {}, detail = scriptDetail(TWO_ROLE_LINES), options: { begin?: boolean } = {}) {
  const { server } = await openFixtureScript(detail);
  setCurrentSession(sessionDetail({ advance: 'silence', record: true, ...over }));
  await render(<ReadingPlay />);
  if (options.begin ?? true) await begin();
  return server;
}

/** 내 차례에 침묵 감지가 말 끝을 알린다. */
async function speechEnds(source: () => Listener | null = () => mic) {
  await waitFor(() => expect(source()).not.toBeNull());
  const listener = source()!;
  mic = null;
  recognizer = null;
  await act(async () => listener.onEvent('speech_end'));
}

test('현재 대본이나 회차가 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingPlay />);

  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading');
});

test('회차 구간의 줄이 대본에 없으면 실행하지 않는다', async () => {
  await startPlay({ start_line_id: 'gone' }, undefined, { begin: false });
  expect(screen.getByText('대본이 없어요.')).toBeOnTheScreen();
});

test('상대 대사를 읽고 내 대사에서 기다렸다가 말이 끝나면 넘기고, 끝까지 가면 완료 화면을 보인다', async () => {
  const server = await startPlay();

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.getByText('0 / 3 · 01:05')).toBeOnTheScreen();
  expect(await screen.findByText('듣는 중')).toBeOnTheScreen();

  await speechEnds();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(screen.getByText('응, 늦어서 미안해.')).toBeOnTheScreen();
  expect(screen.getByText('(서연이 자리에 앉는다.)')).toBeOnTheScreen();
  expect(tts.play).toHaveBeenCalledWith('file:///speech.wav');
  expect(queue.take).toHaveBeenCalledWith({ text: '응, 늦어서 미안해.', preset: 'F1', lang: 'ko' });
  await waitFor(() => expect(screen.getByText('괜찮아.')).toBeOnTheScreen());

  await speechEnds();
  // 음성 인식을 못 쓰는 기기(typing)는 인식된 대사 없이도 끝까지 가면 완료다(SOMA-773 예외).
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(screen.queryByText('연습으로 세지 않았어요')).not.toBeOnTheScreen();
  expect(screen.getByText('내 배역 · 민재')).toBeOnTheScreen();
  expect(screen.getByText('읽은 대사 3줄')).toBeOnTheScreen();
  expect(screen.getByText('이 기기에서는 말한 것을 글자로 바꾸지 못해 비교하지 않았어요.')).toBeOnTheScreen();
  await waitFor(() =>
    expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ current_line_id: null, complete: true, line_results: [] })),
  );
  expect(server.saveProgress.mock.calls.map(([, body]) => body.current_line_id)).toEqual(['l4', 'l5', null]);
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => [input.lineId, input.attemptNo, input.uri, input.contentType])).toEqual([
    ['l2', 1, 'file:///turn.m4a', 'audio/mp4'],
    ['l5', 1, 'file:///turn.m4a', 'audio/mp4'],
  ]);
  expect(mockAskRating).toHaveBeenCalledWith({ kind: 'reading' });

  await pressWhenReady('완료');
  expect(await screen.findByText('오늘 리딩 끝!')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('확인'));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).not.toHaveBeenCalled();
});

test('음성 인식이 되면 내 차례에 알아들은 말을 보이고, 완료 저장 응답의 다르게 말한 대사를 완료 화면에 보인다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  const different = [
    { line_id: 'l5', dialogue_no: 3, said: '괜찮다', different_words: [{ text: '괜찮아.', differs: true }] },
  ];
  const server = await startPlay();
  server.saveProgress.mockImplementation(async (_id, body) => ({
    current_line_id: body.current_line_id ?? null,
    elapsed_seconds: 0,
    progress_seq: body.progress_seq,
    status: body.complete ? 'completed' : 'in_progress',
    different_lines: body.complete ? different : [],
  }));

  expect(await screen.findByText('아직 인식된 말이 없어요')).toBeOnTheScreen();
  expect(mockStt.start).toHaveBeenCalledWith(expect.anything(), { persist: true, locale: 'ko-KR' });
  await act(async () => recognizer!.onInterim!('오늘 왔'));
  expect(screen.getByText('오늘 왔')).toBeOnTheScreen();

  mockStt.finish.mockResolvedValueOnce('오늘 왔구나');
  await speechEnds(() => recognizer);
  await waitFor(() => expect(screen.getByText('괜찮아.')).toBeOnTheScreen());
  mockStt.finish.mockResolvedValueOnce('괜찮다');
  await speechEnds(() => recognizer);

  expect(await screen.findByText('원문과 다르게 말한 대사')).toBeOnTheScreen();
  expect(screen.getByText('1개')).toBeOnTheScreen();
  expect(screen.getByText('3번 대사')).toBeOnTheScreen();
  expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({
    complete: true,
    line_results: [{ line_id: 'l2', said: '오늘 왔구나' }, { line_id: 'l5', said: '괜찮다' }],
  }));
  expect(jest.mocked(enqueueLineRecording).mock.calls[0][0]).toEqual(expect.objectContaining({
    lineId: 'l2',
    uri: 'file:///turn.wav',
    contentType: 'audio/wav',
    transcript: '오늘 왔구나',
    transcriptSource: 'stt',
  }));
  expect(getLastRunReview()).toEqual({ sessionId: 'r1', startIndex: 1, endIndex: 4, myRoles: ['민재'], different });

  await fireEvent.press(screen.getByText('전체 보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/diff');
});

test('녹음을 남기지 못하는 인식기면 녹음기로 받는다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockStt.canPersist.mockReturnValue(false);
  await startPlay();

  await screen.findByText('듣는 중');
  expect(mockStt.start).not.toHaveBeenCalled();
  expect(mockMic.start).toHaveBeenCalledTimes(1);
});

test('마이크 권한이 없으면 안내하고, 설정에서 켜고 돌아오면 이어서 시작한다', async () => {
  jest.mocked(hasMicPermission).mockResolvedValue(false);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await startPlay({}, undefined, { begin: false });

  expect(await screen.findByText('마이크 권한이 필요해요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('설정 열기'));
  expect(openSettings).toHaveBeenCalledTimes(1);

  jest.mocked(micPermissionGranted).mockResolvedValueOnce(false);
  await act(async () => appStateListeners.forEach((l) => l('active')));
  expect(screen.getByText('마이크 권한이 필요해요')).toBeOnTheScreen();

  await act(async () => appStateListeners.forEach((l) => l('background')));
  expect(screen.getByText('마이크 권한이 필요해요')).toBeOnTheScreen();

  await act(async () => appStateListeners.forEach((l) => l('active')));
  await begin();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
});

test('마이크 안내에서 나가면 대본 상세로 간다', async () => {
  jest.mocked(hasMicPermission).mockResolvedValue(false);
  const server = await startPlay({}, undefined, { begin: false });

  await fireEvent.press(await screen.findByText('나가기'));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(mockRouter.replace).not.toHaveBeenCalledWith('/reading/detail');
  // [시작] 전이라 이번 회차를 남기지 않는다.
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
});

test('일시정지하면 위치를 저장하고, 이어서를 누르면 그 줄을 처음부터 다시 듣는다', async () => {
  const server = await startPlay();
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByText('일시정지'));
  expect(screen.getByText('이어서를 누르면 이 줄을 처음부터 다시 해요. 마이크는 그때 켜져요.')).toBeOnTheScreen();
  await waitFor(() => expect(server.saveProgress).toHaveBeenCalledWith('r1', expect.objectContaining({ current_line_id: 'l2', complete: false })));

  await fireEvent.press(screen.getByText('이어서'));
  expect(await screen.findByText('듣는 중')).toBeOnTheScreen();
  expect(mockMic.start).toHaveBeenCalledTimes(2);
});

test('앱이 배경으로 가면 멈춘다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');

  await act(async () => appStateListeners.forEach((l) => l('background')));
  expect(screen.getByText('이어서')).toBeOnTheScreen();
});

test('나가기를 확인하면 진행한 대사 수를 알리고 위치를 저장한 뒤 상세로 간다', async () => {
  const server = await startPlay();
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByText('나가기'));
  expect(screen.getByText('지금 나가면 0번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('취소'));
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('나가기'));
  await fireEvent.press(screen.getAllByText('나가기').at(-1)!);
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ current_line_id: 'l2', complete: false }));
  expect(server.deleteSession).not.toHaveBeenCalled();
});

test('이전 대사를 누르면 앞 대사로 돌아가 다시 한다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');
  expect(screen.getByLabelText('이전 대사')).toBeDisabled();

  await speechEnds();
  await waitFor(() => expect(screen.getByText('괜찮아.')).toBeOnTheScreen());
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByLabelText('이전 대사'));
  expect(await screen.findByText('서연')).toBeOnTheScreen();
  await waitFor(() => expect(queue.take).toHaveBeenCalledTimes(2));
});

test('내 대사만 가리면 내 줄이 막대로 바뀌고, 첫 단어·원문 보기로 그 줄만 드러낸다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByLabelText('대사 보기'));
  expect(screen.getByText('고르는 동안은 다음 줄로 넘어가지 않아요')).toBeOnTheScreen();
  expect(screen.getByText('넘김 멈춤')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('내 대사만 가리기'));
  expect(screen.getByRole('radio', { name: /내 대사만 가리기/ })).toBeChecked();
  expect(screen.queryByText('오늘 왔구나.')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('첫 단어'));
  expect(screen.getByText('오늘')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('원문 보기'));
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.queryByText('첫 단어')).not.toBeOnTheScreen();
});

const PARTNER_FIRST = { start_line_id: 'l4', end_line_id: 'l5' };

test('고품질 목소리를 켰고 쓸 수 있으면 서버 음성으로 읽고, 못 받은 줄은 기기 목소리로 읽으며 한 번 알린다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  jest.mocked(api.getCloudVoiceStatus).mockResolvedValue({ available: true, free_until: null, consent: 'granted', daily_limit: 10, daily_used: 0 });
  queue.take.mockResolvedValue(null);
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText('고품질 목소리를 못 받아 기기 목소리로 읽어요')).toBeOnTheScreen();
  expect(jest.mocked(tts.createQueueFor).mock.calls[0]).toEqual(['s1', expect.objectContaining({ cloud: true })]);
  expect(speakWithDevice).toHaveBeenCalledWith('응, 늦어서 미안해.', 'F1', { locale: 'ko-KR' });
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.ensureReady).not.toHaveBeenCalled();
});

test('서버 음성을 못 받았는데 기기 목소리도 없으면 글로 보이고 다음을 눌러 넘긴다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  jest.mocked(api.getCloudVoiceStatus).mockResolvedValue({ available: true, free_until: null, consent: 'granted', daily_limit: 10, daily_used: 0 });
  jest.mocked(hasDeviceVoice).mockResolvedValue(false);
  queue.take.mockResolvedValue(null);
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText('글로 보기')).toBeOnTheScreen();
  expect(speakWithDevice).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText(ME)).toBeOnTheScreen();
});

test('앱 목소리를 못 쓰는 기기는 처음 한 번 안내하고, 계속하면 기기 목소리로 읽으며 다시 묻지 않게 남긴다', async () => {
  await AsyncStorage.setItem('acttub.reading.appVoiceUnsupported', '1');
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('이 기기에서는\n앱 목소리를 쓸 수 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('계속하기'));
  await begin();

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(speakWithDevice).toHaveBeenCalledWith('응, 늦어서 미안해.', 'F1', { locale: 'ko-KR' });
  expect(await AsyncStorage.getItem('acttub.reading.appVoiceUnsupported')).toBe('noticed');
});

test('앱 목소리를 못 쓴다는 안내를 이미 봤으면 바로 기기 목소리로 시작한다', async () => {
  await AsyncStorage.setItem('acttub.reading.appVoiceUnsupported', 'noticed');
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(speakWithDevice).toHaveBeenCalledWith('응, 늦어서 미안해.', 'F1', { locale: 'ko-KR' });
});

test('앱 목소리 안내에서 나가면 상세로 간다', async () => {
  await AsyncStorage.setItem('acttub.reading.appVoiceUnsupported', '1');
  const server = await startPlay(PARTNER_FIRST, undefined, { begin: false });

  await fireEvent.press(await screen.findByLabelText('뒤로'));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
});

test('목소리가 없고 Wi-Fi 가 아니면 용량을 묻고, 받지 않으면 기기 목소리로 읽는다', async () => {
  jest.mocked(missingModelBytes).mockReturnValue(400 * 1024 * 1024);
  jest.mocked(currentNetworkType).mockResolvedValue('cellular');
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('상대역 목소리를 내려받을까요?')).toBeOnTheScreen();
  expect(screen.getByText('Wi-Fi가 아니에요. 약 400.0MB를 한 번 내려받아요. 지금 받지 않으면 상대 대사를 기기 기본 목소리로 읽어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('기기 목소리로 시작'));
  await begin();

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(speakWithDevice).toHaveBeenCalledWith('응, 늦어서 미안해.', 'F1', { locale: 'ko-KR' });
  expect(tts.ensureReady).not.toHaveBeenCalled();
});

test('목소리 모델을 다 받아 둔 기기는 이동통신이어도 내려받기를 묻지 않는다(SOMA-772)', async () => {
  jest.mocked(missingModelBytes).mockReturnValue(0);
  jest.mocked(currentNetworkType).mockResolvedValue('cellular');
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(screen.queryByText('상대역 목소리를 내려받을까요?')).not.toBeOnTheScreen();
  expect(tts.ensureReady).toHaveBeenCalled();
  expect(missingModelBytes).toHaveBeenCalledWith('fp32');
});

test('받다 만 모델이 있으면 남은 양만 묻는다(SOMA-772)', async () => {
  jest.mocked(missingModelBytes).mockReturnValue(100 * 1024 * 1024);
  jest.mocked(currentNetworkType).mockResolvedValue('cellular');
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('Wi-Fi가 아니에요. 약 100.0MB를 한 번 내려받아요. 지금 받지 않으면 상대 대사를 기기 기본 목소리로 읽어요.')).toBeOnTheScreen();
});

test('내려받기를 고르면 받는 양과 불러오는 단계를 보이고, 다 되면 앱 목소리로 읽는다', async () => {
  jest.mocked(missingModelBytes).mockReturnValue(400 * 1024 * 1024);
  jest.mocked(currentNetworkType).mockResolvedValue('cellular');
  let report: (p: Parameters<NonNullable<Parameters<typeof tts.ensureReady>[0]>>[0]) => void = () => undefined;
  let done: () => void = () => undefined;
  jest.mocked(tts.ensureReady).mockImplementation((onProgress) => {
    report = onProgress!;
    return new Promise<void>((resolve) => (done = resolve));
  });
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  await fireEvent.press(await screen.findByText('내려받기'));
  expect(await screen.findByText('음성 준비 중...')).toBeOnTheScreen();

  await act(async () => report({ phase: 'download', receivedBytes: 100 * 1024 * 1024, totalBytes: 400 * 1024 * 1024, percent: 25, etaSeconds: 30 }));
  expect(screen.getByText('상대역 목소리를 준비하고 있어요')).toBeOnTheScreen();
  expect(screen.getByText('100 / 400MB · 곧 끝나요')).toBeOnTheScreen();

  await act(async () => report({ phase: 'load', done: 2, total: 4 }));
  expect(screen.getByText('목소리 불러오는 중')).toBeOnTheScreen();
  expect(screen.getByText('40%')).toBeOnTheScreen();
  await waitFor(async () => expect(await AsyncStorage.getItem('acttub.reading.modelLoadStarted')).toBe('1'));

  await act(async () => report({ phase: 'ready' }));
  expect(screen.getByText('80%')).toBeOnTheScreen();
  await waitFor(async () => expect(await AsyncStorage.getItem('acttub.reading.modelLoadStarted')).toBeNull());

  await act(async () => done());
  await begin();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.play).toHaveBeenCalledWith('file:///speech.wav');
});

test.each([
  ['storage', new VoicePrepareError('storage', 'full', { neededBytes: 500 * 1024 * 1024 }), '저장 공간이 부족해요. 500.0MB 이상 비운 뒤 다시 시도해 주세요.'],
  ['storage(크기 모름)', new VoicePrepareError('storage', 'full'), '저장 공간이 부족해요. 400.0MB 이상 비운 뒤 다시 시도해 주세요.'],
  ['network', new VoicePrepareError('network', 'down'), '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'],
])('목소리 준비가 %s 오류로 실패하면 이유를 알리고 다시 받기로 이어 간다', async (_name, error, message) => {
  jest.mocked(tts.ensureReady).mockRejectedValueOnce(error);
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('상대역 목소리를 못 만들었어요')).toBeOnTheScreen();
  expect(screen.getByText(message)).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('reading_voice_failed', { kind: (error as VoicePrepareError).kind });

  await fireEvent.press(screen.getByText('다시 시도'));
  await begin();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
});

test('이유를 모르는 준비 실패는 이유 줄 없이 안내만 보이고, 뒤로 가면 상세로 간다', async () => {
  jest.mocked(tts.ensureReady).mockRejectedValueOnce(new Error('boom'));
  const server = await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('상대역 목소리를 못 만들었어요')).toBeOnTheScreen();
  expect(screen.getByText('「다시 시도」를 누르세요. 안 되면 기기 목소리로 해요.')).toBeOnTheScreen();
  expect(screen.queryByText('인터넷 연결을 확인한 뒤 다시 시도해 주세요.')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText('뒤로'));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
});

test('모델을 못 올리면 이 기기를 앱 목소리 불가로 남기고 받은 모델을 지운 뒤 안내한다', async () => {
  jest.mocked(tts.ensureReady).mockRejectedValueOnce(new VoicePrepareError('model_load', 'bad model'));
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('이 기기에서는\n앱 목소리를 쓸 수 없어요')).toBeOnTheScreen();
  expect(removeDownloadedAssets).toHaveBeenCalledWith('fp32');
  expect(await AsyncStorage.getItem('acttub.reading.appVoiceUnsupported')).toBe('1');
});

test('미리 만든 음성이 없으면 앱 목소리로 그 자리에서 읽는다', async () => {
  queue.take.mockResolvedValue(null);
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.speak).toHaveBeenCalledWith('응, 늦어서 미안해.', 'F1', { scriptId: 's1', lang: 'ko' });
});

test('상대 줄 하나를 못 읽어도 기록만 남기고 다음 줄로 넘어간다', async () => {
  jest.mocked(tts.play).mockRejectedValueOnce(new Error('player crashed'));
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('reading_line_voice_failed', { engine: 'supertonic', kind: 'unknown' });
});

test('구간에 상대 대사가 없으면 목소리를 준비하지 않는다', async () => {
  await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.ensureReady).not.toHaveBeenCalled();
});

test('자동 넘김 안내를 숨기지 않았으면 [시작] 위에 안내를 보이고, 숨기기를 누르면 이 기기에 남긴 뒤 시작한다', async () => {
  await AsyncStorage.removeItem('acttub.reading.autoAdvanceTipHidden');
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('말이 끝나면 저절로 넘어가요. 준비되면 「시작」을 누르세요.')).toBeOnTheScreen();
  expect(screen.getByText('시작 전')).toBeOnTheScreen();
  expect(queue.take).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('시작하고 이 안내는 다음부터 숨기기'));
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(await AsyncStorage.getItem('acttub.reading.autoAdvanceTipHidden')).toBe('1');
});

test('자동 넘김 안내를 [시작]으로 닫으면 다음에 또 띄운다', async () => {
  await AsyncStorage.removeItem('acttub.reading.autoAdvanceTipHidden');
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(await AsyncStorage.getItem('acttub.reading.autoAdvanceTipHidden')).toBeNull();
});

test('자동 넘김 안내를 숨겼어도 준비가 끝나면 바로 읽지 않고 [시작]을 기다린다(SOMA-772)', async () => {
  await startPlay(PARTNER_FIRST, undefined, { begin: false });

  expect(await screen.findByText('시작')).toBeOnTheScreen();
  expect(screen.queryByText('말이 끝나면 저절로 넘어가요. 준비되면 「시작」을 누르세요.')).not.toBeOnTheScreen();
  expect(screen.queryByText('시작하고 이 안내는 다음부터 숨기기')).not.toBeOnTheScreen();
  await act(async () => undefined);
  expect(queue.take).not.toHaveBeenCalled();
  expect(tts.play).not.toHaveBeenCalled();

  await begin();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.play).toHaveBeenCalledWith('file:///speech.wav');
});

test('버튼으로 넘기는 옛 회차에는 자동 넘김 안내가 없고 말이 끝나도 넘어가지 않는다', async () => {
  await AsyncStorage.removeItem('acttub.reading.autoAdvanceTipHidden');
  await startPlay({ advance: 'manual' }, undefined, { begin: false });
  expect(await screen.findByText('시작')).toBeOnTheScreen();
  expect(screen.queryByText('말이 끝나면 저절로 넘어가요. 준비되면 「시작」을 누르세요.')).not.toBeOnTheScreen();
  await begin();
  await screen.findByText('듣는 중');

  await speechEnds();
  expect(screen.getByText(ME)).toBeOnTheScreen();
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('서연')).toBeOnTheScreen();
});

test('대사 보기 시트가 떠 있는 동안 말이 끝나면 넘김을 미뤘다가, 시트를 닫고 침묵이 이어지면 넘긴다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');
  const listener = mic!;

  await fireEvent.press(screen.getByLabelText('대사 보기'));
  await act(async () => listener.onEvent('speech_end'));
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();

  jest.useFakeTimers();
  try {
    await fireEvent.press(screen.getByText('모든 대사 보기'));
    await closeModalOf('대사 보기');
    await act(async () => jest.advanceTimersByTime(2000));
  } finally {
    jest.useRealTimers();
  }
  expect(await screen.findByText('서연')).toBeOnTheScreen();
});

test('시트를 닫은 뒤 다시 말하기 시작하면 미뤄 둔 넘김을 버린다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');
  const listener = mic!;

  await fireEvent.press(screen.getByLabelText('대사 보기'));
  await act(async () => listener.onEvent('speech_end'));
  jest.useFakeTimers();
  try {
    await closeModalOf('대사 보기');
    await act(async () => listener.onEvent('speech_start'));
    await act(async () => jest.advanceTimersByTime(5000));
  } finally {
    jest.useRealTimers();
  }
  expect(screen.getByText(ME)).toBeOnTheScreen();
});

test('상대 대사를 읽는 동안 시트가 떠 있으면 다 읽어도 시트를 닫을 때까지 넘기지 않는다', async () => {
  let spoken: () => void = () => undefined;
  jest.mocked(tts.play).mockImplementationOnce(() => new Promise<void>((resolve) => (spoken = resolve)));
  await startPlay(PARTNER_FIRST);
  await waitFor(() => expect(tts.play).toHaveBeenCalled());
  expect(screen.getByText('읽는 중')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('대사 보기'));
  await act(async () => spoken());
  expect(screen.queryByText(ME)).not.toBeOnTheScreen();

  await closeModalOf('대사 보기');
  expect(await screen.findByText(ME)).toBeOnTheScreen();
});

test('말이 오래 없으면 다음으로 넘기라고 알린다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');

  await act(async () => mic!.onEvent('timeout'));
  expect(screen.getByText('말이 들리지 않아요. 다음을 눌러 넘길 수 있어요.')).toBeOnTheScreen();
});

test('마이크를 못 열면 버튼으로 넘기라고 알린다', async () => {
  mockMic.start.mockResolvedValue(false);
  await startPlay();

  expect(await screen.findByText('말이 들리지 않아요. 다음을 눌러 넘길 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('마이크 켜는 중')).toBeOnTheScreen();
});

test('한 줄 녹음이 3분에 이르면 녹음을 멈춰 올리고, 다음을 눌러도 다시 올리지 않는다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  mockStt.finish.mockResolvedValue('오늘 왔구나');
  jest.useFakeTimers();
  try {
    await startPlay();
    await act(async () => undefined);
    await act(async () => undefined);
    expect(screen.getByText('듣는 중')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(180_000));
    await act(async () => undefined);
  } finally {
    jest.useRealTimers();
  }
  expect(await screen.findByText('녹음 3분 끝')).toBeOnTheScreen();
  expect(screen.getByText('녹음은 한 줄에 3분까지예요. 다음을 눌러 넘겨요.')).toBeOnTheScreen();
  await waitFor(() => expect(enqueueLineRecording).toHaveBeenCalledTimes(1));

  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('서연')).toBeOnTheScreen();
  expect(enqueueLineRecording).toHaveBeenCalledTimes(1);
});

test('너무 커서 못 보낸 녹음은 위쪽에 잠깐 알린다', async () => {
  jest.mocked(enqueueLineRecording).mockResolvedValue({ kind: 'rejected', reason: 'too_large' });
  await startPlay();
  await screen.findByText('듣는 중');

  await speechEnds();
  expect(await screen.findByText('녹음 1개 저장 못 함')).toBeOnTheScreen();
});

test('비어 있는 녹음은 알리지 않고 종류만 기록한다', async () => {
  jest.mocked(enqueueLineRecording).mockResolvedValue({ kind: 'rejected', reason: 'empty' });
  await startPlay();
  await screen.findByText('듣는 중');

  await speechEnds();
  await waitFor(() => expect(logEvent).toHaveBeenCalledWith('reading_recording_empty', { kind: 'recorder', reason: 'empty', platform: 'ios' }));
  expect(screen.queryByText('녹음 1개 저장 못 함')).not.toBeOnTheScreen();
});

test('녹음을 끈 회차는 내 차례의 녹음 파일을 올리지 않고 지운다', async () => {
  await startPlay({ record: false });
  await screen.findByText('듣는 중');

  await speechEnds();
  await waitFor(() => expect(deleteDeviceFile).toHaveBeenCalledWith('file:///turn.m4a'));
  expect(enqueueLineRecording).not.toHaveBeenCalled();
});

test('같은 줄을 다시 말하면 시도 번호를 올려 앞 녹음을 대체한다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await speechEnds();
  await waitFor(() => expect(tts.play).toHaveBeenCalled());

  await fireEvent.press(screen.getByLabelText('이전 대사'));
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  await speechEnds();

  await waitFor(() => expect(enqueueLineRecording).toHaveBeenCalledTimes(2));
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => [input.lineId, input.attemptNo])).toEqual([
    ['l2', 1],
    ['l2', 2],
  ]);
});

test('리딩 중 지금 줄을 고치면 멈췄다가, 저장하면 고친 글로 그 줄을 처음부터 다시 한다', async () => {
  const fixed = scriptDetail([TWO_ROLE_LINES[0], ['dialogue', '민재', '오늘 와 줬구나.'], ...TWO_ROLE_LINES.slice(2)]);
  const server = await startPlay();
  server.patchLine.mockResolvedValue(fixed);
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByLabelText('줄 고치기'));
  expect(screen.getByText('이어서')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('글'), '오늘 와 줬구나.');
  await fireEvent.press(screen.getByText('저장'));

  expect(await screen.findByText('오늘 와 줬구나.')).toBeOnTheScreen();
  expect(server.patchLine).toHaveBeenCalledWith('s1', 'l2', { text: '오늘 와 줬구나.' });
  expect(await screen.findByText('듣는 중')).toBeOnTheScreen();
  await waitFor(() => expect(server.saveProgress).toHaveBeenCalledWith('r1', expect.objectContaining({ current_line_id: 'l2' })));
});

test('멈춘 채 줄 고치기를 열었다 닫으면 멈춘 채로 둔다', async () => {
  await startPlay();
  await screen.findByText('듣는 중');
  await fireEvent.press(screen.getByText('일시정지'));

  await fireEvent.press(screen.getByLabelText('줄 고치기'));
  await fireEvent.press(screen.getByText('취소'));
  expect(screen.getByText('이어서')).toBeOnTheScreen();
});

test('고친 줄이 대사가 아니게 되고 남은 대사가 없으면 완료로 간다', async () => {
  // 배역이 둘인 대본의 마지막 줄 하나만 구간이다 — 배역이 하나뿐이면 독백이라 다른 화면이다(SOMA-597).
  const detail = scriptDetail(TWO_ROLE_LINES);
  const asDirection = { ...detail, lines: detail.lines.map((l) => (l.id === 'l5' ? { ...l, kind: 'direction' as const, character_id: null, dialogue_no: null } : l)) };
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' }, detail);
  server.patchLine.mockResolvedValue(asDirection);
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByLabelText('줄 고치기'));
  await fireEvent.press(screen.getByText('지문'));
  await fireEvent.press(screen.getByText('저장'));

  // 인식을 못 쓰는 기기(typing)라 말한 대사 없이 끝나도 완료다(SOMA-773 예외).
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(server.patchLine).toHaveBeenCalledWith('s1', 'l5', { kind: 'direction' });
});

test('인식된 말 없이 「다음」만으로 끝까지 가면 완료로 보내지 않고 별점도 묻지 않는다(SOMA-773)', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('아직 인식된 말이 없어요');

  await speechEnds(() => recognizer);
  expect(await screen.findByText('연습으로 세지 않았어요')).toBeOnTheScreen();
  expect(screen.getByText('알아들은 대사가 없어서 이번 리딩은 완료로 남기지 않았어요. 대사를 소리 내어 읽으면 완료로 세요.')).toBeOnTheScreen();
  expect(screen.queryByText('리딩 완료')).not.toBeOnTheScreen();
  expect(screen.queryByText('이번 리딩 어땠나요?')).not.toBeOnTheScreen();
  expect(screen.queryByText('말한 것을 원문과 비교하고 있어요.')).not.toBeOnTheScreen();
  expect(server.saveProgress).not.toHaveBeenCalledWith('r1', expect.objectContaining({ complete: true }));
  expect(mockAskRating).not.toHaveBeenCalled();
});

test('음성 인식을 못 쓰는 기기는 인식된 말 없이 끝까지 가도 완료로 보내고 별점을 묻는다(SOMA-773 예외)', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'typing', reason: 'denied' });
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('듣는 중');

  await speechEnds();
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(screen.queryByText('연습으로 세지 않았어요')).not.toBeOnTheScreen();
  await waitFor(() => expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ complete: true })));
  expect(mockAskRating).toHaveBeenCalledWith({ kind: 'reading' });
});

test('이어하기 전에 서버가 받은 인식이 있으면 이번에 말이 없어도 완료다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  const server = await startPlay({
    start_line_id: 'l5',
    end_line_id: 'l5',
    different_lines: [{ line_id: 'l2', dialogue_no: 1, said: '오늘 왔다', different_words: [{ text: '오늘', differs: false }] }],
  });
  await screen.findByText('아직 인식된 말이 없어요');

  await speechEnds(() => recognizer);
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  await waitFor(() => expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ complete: true })));
  expect(mockAskRating).toHaveBeenCalledWith({ kind: 'reading' });
});

test('진행 저장이 끝난 회차라고 거절되면 실행을 닫고 상세로 안내한다', async () => {
  const server = await startPlay();
  server.saveProgress.mockRejectedValue(new ApiError(409, 'closed', 'session_closed'));
  await screen.findByText('듣는 중');

  await speechEnds();
  expect(await screen.findByText('이미 끝난 회차예요. 상세에서 새로 시작해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('상세로'));
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).not.toHaveBeenCalled();
});

test('완료 저장이 끊기면 나중에 보여 준다고 알린다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  server.saveProgress.mockRejectedValue(new Error('offline'));
  await screen.findByText('아직 인식된 말이 없어요');

  mockStt.finish.mockResolvedValueOnce('괜찮아');
  await speechEnds(() => recognizer);
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(await screen.findByText('연결되면 비교 결과를 보여 드릴게요.')).toBeOnTheScreen();
});

test('완료 저장의 응답을 잃어 끝난 회차라고 거절되면 회차 상세의 비교 결과를 보인다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  const different = [{ line_id: 'l5', dialogue_no: 3, said: '괜찮다', different_words: [{ text: '괜찮아.', differs: true }] }];
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  server.saveProgress.mockRejectedValue(new ApiError(409, 'closed', 'session_closed'));
  let answer: () => void = () => undefined;
  server.getSession.mockImplementation(() => new Promise((resolve) => (answer = () => resolve(sessionDetail({ different_lines: different })))));
  await screen.findByText('아직 인식된 말이 없어요');

  mockStt.finish.mockResolvedValueOnce('괜찮다');
  await speechEnds(() => recognizer);
  expect(await screen.findByText('말한 것을 원문과 비교하고 있어요.')).toBeOnTheScreen();
  await act(async () => answer());
  expect(await screen.findByText('원문과 다르게 말한 대사')).toBeOnTheScreen();
  expect(screen.getByText('이번 연습 구간의 대사예요.', { exact: false })).toBeOnTheScreen();
  expect(screen.queryByText('이미 끝난 회차예요. 상세에서 새로 시작해 주세요.')).not.toBeOnTheScreen();
});

test('완료 화면의 다시 연습은 같은 설정으로 새 회차를 시작해 실행 화면을 다시 연다', async () => {
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  server.startSession.mockResolvedValue(sessionDetail({ id: 'r2' }));
  await screen.findByText('듣는 중');
  await speechEnds();

  await pressWhenReady('다시 연습');
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/play'));
  expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({
    my_character_ids: ['c1'],
    start_line_id: 'l5',
    end_line_id: 'l5',
    mode: 'read',
    advance: 'silence',
    record: true,
  }));
});

test('다시 연습을 시작하지 못하면 이유를 알린다', async () => {
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  server.startSession.mockRejectedValue(new ApiError(422, 'bad', 'invalid_characters'));
  await screen.findByText('듣는 중');
  await speechEnds();

  await pressWhenReady('다시 연습');
  expect(await screen.findByText('연습을 시작하지 못했어요')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalledWith('/reading/play');
});

test('리딩 마무리에서 코치에게 보여 주기로 가면 대본 제목·장면·내 배역을 장면 칸에 채워 업로드 화면을 연다(SOMA-772)', async () => {
  await startPlay({ start_line_id: 'l5', end_line_id: 'l5' }, scriptDetail(TWO_ROLE_LINES, {
    scenes: [{ no: 1, title: '1장 카페', start_line_id: 'l1', end_line_id: 'l5', dialogue_count: 3 }],
  }));
  await screen.findByText('듣는 중');
  await speechEnds();

  await pressWhenReady('완료');
  await fireEvent.press(await screen.findByText('이 장면, 찍어서 코치에게 보여 주기'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/upload');
  expect(takeContinueOrigin()).toEqual({ kind: 'reading', scene: { situation: '봄날의 대화 · 1장 카페', character: '민재', goal: '' } });
});

test('완료 화면이 뜬 직후에는 다시 연습·완료를 받지 않고, 다시 연습은 실행 중 [다음] 자리(아래 줄)에 두지 않는다(SOMA-772)', async () => {
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('듣는 중');
  await speechEnds();

  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다시 연습' })).toBeDisabled();
  await fireEvent.press(screen.getByText('다시 연습'));
  await fireEvent.press(screen.getByText('완료'));
  expect(server.startSession).not.toHaveBeenCalled();
  expect(screen.queryByText('오늘 리딩 끝!')).not.toBeOnTheScreen();
  await waitFor(() => expect(screen.getByRole('button', { name: '다시 연습' })).toBeEnabled(), { timeout: 2000 });
});

test('올리는 중인 녹음이 있으면 완료 화면에 수를 보인다', async () => {
  jest.mocked(pendingRecordingUploads).mockResolvedValue(2);
  await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('듣는 중');
  await speechEnds();

  expect(await screen.findByText('녹음 2개 저장 중')).toBeOnTheScreen();
});

test('이어 하기는 저장된 줄 바로 앞 상대 대사부터 읽고, 그 상대 대사의 위치는 저장하지 않는다', async () => {
  const server = await startPlay({ current_line_id: 'l5', progress_seq: 3, progress: { done: 2, total: 3 } });

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(queue.take).toHaveBeenCalledWith({ text: '응, 늦어서 미안해.', preset: 'F1', lang: 'ko' });
  await screen.findByText('괜찮아.');
  await waitFor(() => expect(server.saveProgress).toHaveBeenCalledWith('r1', expect.objectContaining({ progress_seq: 4, current_line_id: 'l5' })));
  expect(server.saveProgress).toHaveBeenCalledTimes(1);
});

test('튜토리얼로 온 리딩은 여기서 튜토리얼을 끝내고, 완료 화면에서 평가를 묻지 않는다', async () => {
  startTutorial('sample', 'reading');
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('아직 인식된 말이 없어요');
  expect(currentTutorial()).toBeNull();

  mockStt.finish.mockResolvedValueOnce('괜찮아');
  await speechEnds(() => recognizer);
  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(screen.queryByText('이번 리딩 어땠나요?')).not.toBeOnTheScreen();
  expect(mockAskRating).not.toHaveBeenCalled();
  await waitFor(async () => expect(await AsyncStorage.getItem('acttub.tutorial.reading.seen')).not.toBeNull());
});

test('발음 피드백을 켜면 받아쓴 글과 대본이 다르게 들린 어구를 완료 화면에 모은다', async () => {
  await AsyncStorage.setItem('acttub.reading.voiceFeedback', '1');
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  await startPlay({ start_line_id: 'l2', end_line_id: 'l2' });
  await screen.findByText('아직 인식된 말이 없어요');

  mockStt.finish.mockResolvedValueOnce('오늘 갔구나');
  await speechEnds(() => recognizer);

  expect(await screen.findByText('발음 피드백')).toBeOnTheScreen();
  expect(screen.getByText('실험 기능 · 받아쓴 내 대사 1줄 중 1줄에 다르게 들린 곳')).toBeOnTheScreen();
  expect(screen.getByText('‘왔구나’ → ‘갔구나’로 들렸어요')).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('reading_pronunciation_feedback', { notes: 1 });
});

test('발음 채점 서버가 켜져 있으면 줄 녹음의 복사본을 보내 소리 단위 결과를 모으고 복사본은 지운다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test/';
  let reply: () => void = () => undefined;
  const fetchMock = jest.fn(() => new Promise((resolve) => (reply = () => resolve({
    ok: true,
    json: async () => ({ notes: [{ word: '왔구나', phones: [{ expected: 'ㅘ', heard: 'ㅏ' }] }] }),
  }))));
  global.fetch = fetchMock as never;
  await AsyncStorage.setItem('acttub.reading.voiceFeedback', '1');
  try {
    await startPlay({ start_line_id: 'l2', end_line_id: 'l2' });
    await screen.findByText('듣는 중');
    await speechEnds();

    expect(await screen.findByText('소리 분석 중…')).toBeOnTheScreen();
    expect(fetchMock.mock.calls[0][0]).toBe('http://pron.test/score');
    await act(async () => reply());
    expect(await screen.findByText('‘왔구나’ — ㅘ이(가) ㅏ처럼 들렸어요')).toBeOnTheScreen();
    expect(screen.queryByText('소리 분석 중…')).not.toBeOnTheScreen();
    const [copy] = mockFileOps;
    expect(copy.slice(0, 2)).toEqual(['copy', 'file:///turn.m4a']);
    expect(copy[2]).toMatch(/^file:\/\/\/cache\/pron-\d+-l2\.m4a$/);
    expect(mockFileOps.at(-1)).toEqual(['delete', copy[2]]);
  } finally {
    delete process.env.EXPO_PUBLIC_PRON_URL;
  }
});

test('발음 채점 서버가 실패해도 완료 화면은 받아쓴 글 대조만 보인다', async () => {
  process.env.EXPO_PUBLIC_PRON_URL = 'http://pron.test';
  global.fetch = jest.fn(async () => { throw new Error('down'); }) as never;
  await AsyncStorage.setItem('acttub.reading.voiceFeedback', '1');
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  mockStt.finish.mockResolvedValue('오늘 왔구나');
  try {
    await startPlay({ start_line_id: 'l2', end_line_id: 'l2', record: false });
    await screen.findByText('아직 인식된 말이 없어요');
    expect(mockStt.start).toHaveBeenCalledWith(expect.anything(), { persist: true, locale: 'ko-KR' });
    await speechEnds(() => recognizer);

    expect(await screen.findByText('실험 기능 · 받아쓴 내 대사 1줄 중 0줄에 다르게 들린 곳')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('소리 분석 중…')).not.toBeOnTheScreen());
    expect(mockFileOps.at(-1)?.[0]).toBe('delete');
  } finally {
    delete process.env.EXPO_PUBLIC_PRON_URL;
  }
});

test('녹음을 끈 회차는 음성 인식에 녹음을 남기라고 하지 않는다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  await startPlay({ record: false });

  await screen.findByText('아직 인식된 말이 없어요');
  expect(mockStt.start).toHaveBeenCalledWith(expect.anything(), { persist: false, locale: 'ko-KR' });
});

test('발음 피드백이 켜져 있어도 받아쓰지 않은 줄은 다르게 들린 곳을 찾지 않는다', async () => {
  await AsyncStorage.setItem('acttub.reading.voiceFeedback', '1');
  await startPlay({ start_line_id: 'l2', end_line_id: 'l2' });
  await screen.findByText('듣는 중');
  await speechEnds();

  expect(await screen.findByText('리딩 완료')).toBeOnTheScreen();
  expect(screen.queryByText('발음 피드백')).not.toBeOnTheScreen();
  expect(logEvent).not.toHaveBeenCalledWith('reading_pronunciation_feedback', expect.anything());
});

test('못 보낸 녹음이 이어지면 수를 더해 알리고 잠시 뒤 지운다', async () => {
  jest.mocked(enqueueLineRecording).mockResolvedValue({ kind: 'rejected', reason: 'too_long' });
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay();
  await screen.findByText('듣는 중');
  await speechEnds();
  expect(await screen.findByText('녹음 1개 저장 못 함')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('이전 대사'));
  jest.useFakeTimers();
  try {
    await act(async () => undefined);
    await act(async () => mic!.onEvent('speech_end'));
    await act(async () => undefined);
    expect(screen.getByText('녹음 2개 저장 못 함')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(4000));
  } finally {
    jest.useRealTimers();
  }
  expect(screen.queryByText('녹음 2개 저장 못 함')).not.toBeOnTheScreen();
});

test('녹음 올리기 대기 수가 바뀌면 완료 화면에 바로 반영한다', async () => {
  let notify: (n: number) => void = () => undefined;
  jest.mocked(onRecordingQueueChange).mockImplementation((fn: (n: number) => void) => {
    notify = fn;
    return () => undefined;
  });
  await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  await screen.findByText('듣는 중');
  await speechEnds();
  await screen.findByText('리딩 완료');

  await act(async () => notify(3));
  expect(screen.getByText('녹음 3개 저장 중')).toBeOnTheScreen();
});

test('목소리가 없어도 Wi-Fi 면 묻지 않고 바로 받는다', async () => {
  jest.mocked(missingModelBytes).mockReturnValue(400 * 1024 * 1024);
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(screen.queryByText('상대역 목소리를 내려받을까요?')).not.toBeOnTheScreen();
  expect(tts.ensureReady).toHaveBeenCalledTimes(1);
});

test('앱 목소리도 기기 목소리도 없는 기기는 상대 대사를 글로 보인다', async () => {
  await AsyncStorage.setItem('acttub.reading.appVoiceUnsupported', 'noticed');
  jest.mocked(hasDeviceVoice).mockResolvedValue(false);
  await startPlay(PARTNER_FIRST);

  expect(await screen.findByText('글로 보기')).toBeOnTheScreen();
  expect(screen.getByText('응, 늦어서 미안해.')).toBeOnTheScreen();
});

test('서버 음성을 못 받은 안내는 회차에서 한 번만 띄운다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  jest.mocked(api.getCloudVoiceStatus).mockResolvedValue({ available: true, free_until: null, consent: 'granted', daily_limit: 10, daily_used: 0 });
  queue.take.mockResolvedValue(null);
  const detail = scriptDetail([['dialogue', '서연', '먼저 왔어?'], ['dialogue', '서연', '앉아.'], ['dialogue', '민재', '응.']]);
  await startPlay({ start_line_id: 'l1', end_line_id: 'l3' }, detail);

  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(jest.mocked(speakWithDevice).mock.calls).toEqual([['먼저 왔어?', 'M1', { locale: 'ko-KR' }], ['앉아.', 'M1', { locale: 'ko-KR' }]]);
  expect(screen.getAllByText('고품질 목소리를 못 받아 기기 목소리로 읽어요')).toHaveLength(1);
});

test('한 줄 녹음이 3분에 이르면 녹음기 녹음도 멈춰 올리고 넘기기를 기다린다', async () => {
  jest.useFakeTimers();
  try {
    await startPlay();
    await act(async () => undefined);
    await act(async () => undefined);
    await act(async () => jest.advanceTimersByTime(180_000));
    await act(async () => undefined);
  } finally {
    jest.useRealTimers();
  }
  expect(await screen.findByText('녹음 3분 끝')).toBeOnTheScreen();
  await waitFor(() => expect(jest.mocked(enqueueLineRecording).mock.calls.map(([i]) => [i.lineId, i.transcriptSource])).toEqual([['l2', 'none']]));
});

test('줄이 끝나기 전에 멈추면 그 줄의 녹음 조각을 지운다', async () => {
  mockStt.takeRecordingUri.mockReturnValue('file:///left.wav');
  await startPlay();
  await screen.findByText('듣는 중');

  await fireEvent.press(screen.getByText('일시정지'));
  await waitFor(() => expect(jest.mocked(deleteDeviceFile).mock.calls).toEqual(expect.arrayContaining([['file:///left.wav'], ['file:///turn.m4a']])));
  expect(enqueueLineRecording).not.toHaveBeenCalled();
});

test('모든 대사를 가리면 상대 대사는 막대로 보이고 지나간 내 대사는 원문으로 펼치며, 장면 줄은 그대로 보인다', async () => {
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay({ start_line_id: 'l1' });
  await screen.findByText('듣는 중');
  expect(screen.getByText('1장 카페')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('대사 보기'));
  await fireEvent.press(screen.getByText('모든 대사 가리기'));
  await closeModalOf('대사 보기');
  await speechEnds();
  await waitFor(() => expect(tts.play).toHaveBeenCalled());

  // 지나간 내 대사는 원문으로 펼치고(SOMA-785), 상대 대사는 가린 그대로다.
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.queryByText('응, 늦어서 미안해.')).not.toBeOnTheScreen();
  expect(screen.getByText('1장 카페')).toBeOnTheScreen();
  expect(screen.queryByText('첫 단어')).not.toBeOnTheScreen();
});

test('멈춘 채 나가면 다시 멈추지 않고 그 위치를 저장한다', async () => {
  const server = await startPlay();
  await screen.findByText('듣는 중');
  await fireEvent.press(screen.getByText('일시정지'));

  await fireEvent.press(screen.getByText('나가기'));
  await fireEvent.press(screen.getAllByText('나가기').at(-1)!);
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ current_line_id: 'l2' }));
});

test('다시 연습을 여러 번 눌러도 새 회차는 하나만 시작한다', async () => {
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  let started: () => void = () => undefined;
  server.startSession.mockImplementation(() => new Promise((resolve) => (started = () => resolve(sessionDetail({ id: 'r2' })))));
  await screen.findByText('듣는 중');
  await speechEnds();

  await pressWhenReady('다시 연습');
  await fireEvent.press(screen.getByText('다시 연습'));
  await act(async () => started());
  expect(server.startSession).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/play');
});

test('시작 전에는 대사 보기·다음 버튼 대신 [시작]만 있어 대사 보기 시트를 열 수 없다', async () => {
  await AsyncStorage.removeItem('acttub.reading.autoAdvanceTipHidden');
  await startPlay(PARTNER_FIRST, undefined, { begin: false });
  await screen.findByText('말이 끝나면 저절로 넘어가요. 준비되면 「시작」을 누르세요.');

  expect(screen.queryByLabelText('대사 보기')).not.toBeOnTheScreen();
  expect(screen.queryByText('다음')).not.toBeOnTheScreen();
  expect(screen.queryByText('고르는 동안은 다음 줄로 넘어가지 않아요')).not.toBeOnTheScreen();
});

test('목소리를 준비하는 중에 화면을 떠나면 마이크를 확인하지 않는다', async () => {
  let micAnswer: (ok: boolean) => void = () => undefined;
  jest.mocked(hasMicPermission).mockImplementation(() => new Promise((resolve) => (micAnswer = resolve)));
  await startPlay({}, undefined, { begin: false });
  await screen.unmount();

  await act(async () => micAnswer(true));
  expect(detectSttPolicy).not.toHaveBeenCalled();
});

test('목소리를 받는 중에 화면을 떠나면 준비가 끝나도 실행하지 않는다', async () => {
  let ready: () => void = () => undefined;
  jest.mocked(tts.ensureReady).mockImplementation(() => new Promise<void>((resolve) => (ready = resolve)));
  await startPlay(PARTNER_FIRST, undefined, { begin: false });
  await waitFor(() => expect(tts.ensureReady).toHaveBeenCalled());
  await screen.unmount();

  await act(async () => ready());
  expect(queue.take).not.toHaveBeenCalled();
});

test('목소리 준비가 실패한 뒤 화면을 이미 떠났으면 아무것도 바꾸지 않는다', async () => {
  let fail: () => void = () => undefined;
  jest.mocked(tts.ensureReady).mockImplementation(() => new Promise<void>((_resolve, reject) => (fail = () => reject(new VoicePrepareError('model_load', 'bad')))));
  await startPlay(PARTNER_FIRST, undefined, { begin: false });
  await waitFor(() => expect(tts.ensureReady).toHaveBeenCalled());
  await screen.unmount();

  await act(async () => fail());
  expect(await AsyncStorage.getItem('acttub.reading.appVoiceUnsupported')).toBe('1');
  expect(removeDownloadedAssets).toHaveBeenCalledWith('fp32');
});

test('녹음을 큐에 넣다 실패해도 다음 줄로 넘어간다', async () => {
  jest.mocked(enqueueLineRecording).mockRejectedValue(new Error('disk'));
  await startPlay();
  await screen.findByText('듣는 중');

  await speechEnds();
  await waitFor(() => expect(screen.getByText('괜찮아.')).toBeOnTheScreen());
  expect(screen.queryByText('녹음 1개 저장 못 함')).not.toBeOnTheScreen();
});

test('이어 하기도 준비가 끝나면 [시작]을 눌러야 이어 읽는다', async () => {
  await startPlay({ current_line_id: 'l5', progress_seq: 3, progress: { done: 2, total: 3 } }, undefined, { begin: false });

  expect(await screen.findByText('시작')).toBeOnTheScreen();
  expect(queue.take).not.toHaveBeenCalled();
  await begin();
  await waitFor(() => expect(queue.take).toHaveBeenCalled());
});

test('다르게 말한 대사가 여럿이면 두 줄까지만 보이고 수를 알린다', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  const word = (text: string) => [{ text, differs: true }];
  const server = await startPlay({ start_line_id: 'l5', end_line_id: 'l5' });
  server.saveProgress.mockResolvedValue({
    current_line_id: null,
    elapsed_seconds: 0,
    progress_seq: 1,
    status: 'completed',
    different_lines: [
      { line_id: 'l2', dialogue_no: 1, said: '오늘', different_words: word('오늘') },
      { line_id: 'l5', dialogue_no: 3, said: '괜찮', different_words: word('괜찮아.') },
      { line_id: 'gone', dialogue_no: 9, said: '없음', different_words: word('없는 줄') },
    ],
  });
  await screen.findByText('아직 인식된 말이 없어요');
  mockStt.finish.mockResolvedValueOnce('괜찮');
  await speechEnds(() => recognizer);

  expect(await screen.findByText('3개')).toBeOnTheScreen();
  expect(screen.getByText('1번 대사')).toBeOnTheScreen();
  expect(screen.getByText('3번 대사')).toBeOnTheScreen();
  expect(screen.queryByText('9번 대사')).not.toBeOnTheScreen();
});

test('[시작] 전에 나가기: 저장되지 않는다고 알리고, 회차를 지운 뒤 이미 있는 상세로 돌아간다', async () => {
  const server = await startPlay({}, undefined, { begin: false });
  await screen.findByText('시작');

  await fireEvent.press(screen.getByText('나가기'));
  expect(screen.getByText('아직 시작하지 않아서 이번 연습은 저장되지 않아요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByText('나가기').at(-1)!);
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
  expect(server.deleteSession).toHaveBeenCalledTimes(1);
  expect(server.saveProgress).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();

  // 화면이 내려갈 때(beforeRemove) 다시 지우지 않는다.
  await act(async () => mockRemoveListeners.forEach((fn) => fn()));
  expect(server.deleteSession).toHaveBeenCalledTimes(1);
});

test('[시작] 전 회차 지우기가 실패해도 상세로 나간다', async () => {
  const server = await startPlay({}, undefined, { begin: false });
  server.deleteSession.mockRejectedValue(new Error('offline'));
  await screen.findByText('시작');

  await fireEvent.press(screen.getByText('나가기'));
  await fireEvent.press(screen.getAllByText('나가기').at(-1)!);
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
});

test('이어하기 회차는 [시작] 전에 나가도 지우지 않고 진행 위치 문구를 보인다', async () => {
  const server = await startPlay({ progress_seq: 2, current_line_id: 'l4' }, undefined, { begin: false });
  await screen.findByText('시작');

  await fireEvent.press(screen.getByText('나가기'));
  expect(screen.getByText(/지금 나가면 \d+번 대사까지 진행한 걸로 저장돼요/)).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByText('나가기').at(-1)!);
  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading/detail'));
  expect(server.deleteSession).not.toHaveBeenCalled();
});

test('[시작] 전에 버튼이 아닌 길(뒤로 가기)로 내려가도 회차를 지운다, 시작한 뒤에는 지우지 않는다', async () => {
  const server = await startPlay({}, undefined, { begin: false });
  await screen.findByText('시작');
  await act(async () => mockRemoveListeners.forEach((fn) => fn()));
  expect(server.deleteSession).toHaveBeenCalledWith('r1');

  const started = await startPlay();
  await screen.findByText('듣는 중');
  await act(async () => mockRemoveListeners.forEach((fn) => fn()));
  expect(started.deleteSession).not.toHaveBeenCalled();
});

async function maskMine() {
  await fireEvent.press(screen.getByLabelText('대사 보기'));
  await fireEvent.press(screen.getByText('내 대사만 가리기'));
  await closeModalOf('대사 보기');
}

test('가린 내 대사는 말한 뒤 원문으로 펼치고, 다르게 말한 어절에 밑줄을 긋고 말한 것을 아래에 보인다(SOMA-785)', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay();
  await screen.findByText('듣는 중');
  await maskMine();
  expect(screen.queryByText('오늘 왔구나.')).not.toBeOnTheScreen();

  mockStt.finish.mockResolvedValueOnce('오늘 왔');
  await speechEnds(() => recognizer);
  await waitFor(() => expect(tts.play).toHaveBeenCalled());

  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.getByText('왔구나.')).toHaveStyle({ textDecorationLine: 'underline' });
  expect(screen.getByText('오늘')).not.toHaveStyle({ textDecorationLine: 'underline' });
  expect(screen.getByText('말한 것  오늘 왔')).toBeOnTheScreen();
});

test('가린 내 대사를 말하지 않고 넘겨도 지나간 줄은 원문으로 보이고, 말한 것 줄은 없다(SOMA-785)', async () => {
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay();
  await screen.findByText('듣는 중');
  await maskMine();

  await fireEvent.press(screen.getByText('다음'));
  await waitFor(() => expect(tts.play).toHaveBeenCalled());
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.queryByText(/^말한 것/)).not.toBeOnTheScreen();
});

test('말이 끝나면 지금 내 줄 카드도 원문을 펼치고 「다 말했어요」를 보이며 첫 단어·원문 보기를 숨긴다(SOMA-785)', async () => {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  await startPlay();
  await screen.findByText('듣는 중');
  await maskMine();
  expect(screen.getByText('원문 보기')).toBeOnTheScreen();

  mockStt.finish.mockImplementation(() => new Promise<string>(() => undefined)); // 받아쓰기를 거두는 중에 멈춰 둔다
  await speechEnds(() => recognizer);

  expect(await screen.findByText('다 말했어요')).toBeOnTheScreen();
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.queryByText('원문 보기')).not.toBeOnTheScreen();
  expect(screen.queryByText('첫 단어')).not.toBeOnTheScreen();
});

test('지나간 대사를 누르면 상대 목소리를 멈추고 그 줄부터 다시 하며 안내를 띄운다 — 녹음 규칙은 [이전]과 같다(SOMA-785)', async () => {
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  const server = await startPlay();
  await screen.findByText('듣는 중');
  await speechEnds();
  await waitFor(() => expect(tts.play).toHaveBeenCalledTimes(1));

  await fireEvent.press(screen.getByText('오늘 왔구나.'));

  expect(await screen.findByText('「오늘 왔구나.」부터 다시 읽어요')).toBeOnTheScreen();
  expect(await screen.findByText(ME)).toBeOnTheScreen();
  expect(tts.stop).toHaveBeenCalled();
  await waitFor(() => expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ current_line_id: 'l2' })));
  await speechEnds();
  await waitFor(() => expect(enqueueLineRecording).toHaveBeenCalledTimes(2));
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => [input.lineId, input.attemptNo])).toEqual([
    ['l2', 1],
    ['l2', 2],
  ]);
});

test('내 차례에 녹음하던 중 지나간 상대 대사를 누르면 녹음 조각을 지우고 그 상대 대사를 다시 읽는다(SOMA-785)', async () => {
  const server = await startPlay();
  await screen.findByText('듣는 중');
  await speechEnds();
  await waitFor(() => expect(screen.getByText('괜찮아.')).toBeOnTheScreen());
  await screen.findByText('듣는 중');
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  jest.mocked(deleteDeviceFile).mockClear();

  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));

  expect(await screen.findByText('「응, 늦어서 미안해.」부터 다시 읽어요')).toBeOnTheScreen();
  await waitFor(() => expect(deleteDeviceFile).toHaveBeenCalledWith('file:///turn.m4a'));
  await waitFor(() => expect(queue.take).toHaveBeenLastCalledWith({ text: '응, 늦어서 미안해.', preset: 'F1', lang: 'ko' }));
  await waitFor(() => expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({ current_line_id: 'l4' })));
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => input.lineId)).toEqual(['l2']);
});

test('긴 대사로 돌아가면 안내는 대사 앞부분만 보인다(SOMA-785)', async () => {
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay({ start_line_id: 'l1', end_line_id: 'l2' }, scriptDetail([['dialogue', '민재', '오늘은 정말 오래 기다렸어, 너 안 오는 줄 알았거든.'], ['dialogue', '서연', '미안해.']]));
  await screen.findByText('듣는 중');
  await speechEnds();
  await waitFor(() => expect(tts.play).toHaveBeenCalled());

  await fireEvent.press(screen.getByText('오늘은 정말 오래 기다렸어, 너 안 오는 줄 알았거든.'));
  expect(await screen.findByText('「오늘은 정말 오래 기다렸어,…」부터 다시 읽어요')).toBeOnTheScreen();
});

/** 함께 말하는 줄(SOMA-709)이 든 대본 — 묶음 배역은 g1·g2 이고 member_ids 로 멤버를 가리킨다. */
function togetherScript() {
  const seeds: [string, string][] = [
    ['민재', '오늘 왔구나.'],
    ['민재, 서연', '같이 가자.'],
    ['서연, 지호', '우리 먼저 갈게.'],
    ['서연', '응.'],
    ['지호', '그래.'],
  ];
  const detail = scriptDetail(seeds.map(([role, text]) => ['dialogue', role, text] as const) as never);
  const ids: Record<string, string> = { 민재: 'c1', 서연: 'c2', 지호: 'c3', '민재, 서연': 'g1', '서연, 지호': 'g2' };
  const members: Record<string, string[]> = { g1: ['c1', 'c2'], g2: ['c2', 'c3'] };
  // scriptDetail 은 묶음 이름에 c1·c2… 를 겹쳐 주므로 이름으로 다시 맞춘다.
  detail.characters = detail.characters.map((c) => ({ ...c, id: ids[c.name], member_ids: members[ids[c.name]] ?? [] }));
  detail.lines = detail.lines.map((l, i) => ({ ...l, character_id: ids[seeds[i][0]] }));
  return detail;
}

test('함께 말하는 줄에 내 배역이 들어 있으면 내 차례로 듣고, 들어 있지 않으면 상대역이 읽는다. 이름표는 「함께 · 멤버」다(SOMA-785)', async () => {
  jest.mocked(tts.play).mockImplementation(() => new Promise<void>(() => undefined));
  await startPlay({ start_line_id: 'l1', end_line_id: 'l5' }, togetherScript());
  await screen.findByText('듣는 중');
  await speechEnds();

  expect(await screen.findByText('함께 · 민재·서연 · 내 차례')).toBeOnTheScreen();
  expect(await screen.findByText('듣는 중')).toBeOnTheScreen();
  await speechEnds();

  expect(await screen.findByText('함께 · 서연·지호')).toBeOnTheScreen();
  await waitFor(() => expect(queue.take).toHaveBeenCalledWith(expect.objectContaining({ text: '우리 먼저 갈게.' })));
  expect(screen.getByText('함께 · 민재·서연')).toBeOnTheScreen();
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => input.lineId)).toEqual(['l1', 'l2']);
  expect(queue.prime).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ text: '같이 가자.' })]));
});

// ── 독백(SOMA-597) ─────────────────────────────────────────────────────────────
const MONO = scriptDetail([
  ['dialogue', '민지', '그래서 더 말하기 싫었어.'],
  ['dialogue', '민지', '네가 그걸 아니까.'],
  ['dialogue', '민지', '나도 내가 얼마나 준비했는지 알아.'],
  ['dialogue', '민지', '그래서 더 아팠어.'],
]);
type MonoListener = Listener & { onEnd?: () => void };

async function startMonologue() {
  jest.mocked(detectSttPolicy).mockResolvedValue({ kind: 'stt' });
  mockMic.stop.mockResolvedValue(null);
  const server = await startPlay({ start_line_id: 'l1', end_line_id: 'l4', my_character_ids: ['c1'], my_character_names: ['민지'] }, MONO);
  await waitFor(() => expect(recognizer).not.toBeNull());
  return server;
}

test('SOMA-597: 독백은 문장 목록을 한 카드에 보이고 계속 녹음한다 — 상대역 목소리·[이전] 없이 [끝내기], 위에 N / M문장', async () => {
  await startMonologue();

  expect(screen.getByText('민지 · 혼자 읽기')).toBeOnTheScreen();
  expect(await screen.findByText('계속 녹음 중')).toBeOnTheScreen();
  expect(screen.getByText('1 / 4문장 · 01:05')).toBeOnTheScreen();
  for (const text of ['그래서 더 말하기 싫었어.', '네가 그걸 아니까.', '나도 내가 얼마나 준비했는지 알아.', '그래서 더 아팠어.']) {
    expect(screen.getByText(text)).toBeOnTheScreen();
  }
  expect(screen.getByText('끝내기')).toBeOnTheScreen();
  expect(screen.queryByLabelText('이전')).not.toBeOnTheScreen();
  expect(screen.queryByText('다음')).not.toBeOnTheScreen();
  expect(tts.speak).not.toHaveBeenCalled();
  expect(mockStt.start).toHaveBeenCalledTimes(1);
  expect(mockStt.start).toHaveBeenCalledWith(expect.anything(), { persist: true, locale: 'ko-KR' });
});

test('SOMA-597: 읽는 위치를 따라 강조만 옮기고, 말이 멈춰도(일부러 3초 넘게 쉼) 줄이 넘어가거나 녹음이 잘리지 않는다', async () => {
  await startMonologue();
  const listener = recognizer as MonoListener;

  await act(async () => listener.onInterim!('그래서 더 말하기 싫었어'));
  await waitFor(() => expect(screen.getByText('2 / 4문장 · 01:05')).toBeOnTheScreen(), { timeout: 2000 });

  await act(async () => listener.onEvent('speech_end'));
  await act(async () => listener.onEvent('timeout'));
  expect(mockStt.finish).not.toHaveBeenCalled();
  expect(enqueueLineRecording).not.toHaveBeenCalled();
  expect(screen.getByText('2 / 4문장 · 01:05')).toBeOnTheScreen();
  expect(screen.queryByText('끝까지 읽었어요')).not.toBeOnTheScreen();
});

test('SOMA-597: 인식기가 스스로 끝나면 그 조각만 올리고 곧바로 다시 듣는다 — 받아쓴 글은 이어 붙는다', async () => {
  await startMonologue();
  const first = recognizer as MonoListener;
  await act(async () => first.onInterim!('그래서 더 말하기 싫었어'));
  mockStt.finish.mockResolvedValueOnce('그래서 더 말하기 싫었어');
  recognizer = null;

  await act(async () => first.onEnd!());
  await waitFor(() => expect(mockStt.start).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(enqueueLineRecording).toHaveBeenCalledTimes(1));
  expect(jest.mocked(enqueueLineRecording).mock.calls[0][0]).toEqual(
    expect.objectContaining({ lineId: 'l1', uri: 'file:///turn.wav', transcript: null, transcriptSource: 'stt' }),
  );
  await act(async () => (recognizer as MonoListener).onInterim!('네가 그걸'));
  expect(screen.getByText('그래서 더 말하기 싫었어 네가 그걸')).toBeOnTheScreen();
});

test('SOMA-597: 끝내기 — 끝난 뒤 문장별로 맞춰 빠뜨린 문장만 표시하고, 여기부터 다시는 그 문장부터 새 회차를 연다', async () => {
  const server = await startMonologue();
  mockStt.finish.mockResolvedValueOnce('그래서 더 말하기 싫었어 네가 그걸 아니까 그래서 더 아팠어');

  await fireEvent.press(screen.getByText('끝내기'));

  expect(await screen.findByText('끝까지 읽었어요')).toBeOnTheScreen();
  expect(screen.getByText('4문장 중 1문장을 빠뜨렸어요.\n빠진 문장부터 다시 해 볼까요?')).toBeOnTheScreen();
  expect(screen.getByText('3. 나도 내가 얼마나 준비했는지 알아.')).toBeOnTheScreen();
  expect(screen.getByText('빠뜨림 · 여기부터 다시')).toBeOnTheScreen();
  expect(screen.getAllByText('맞게 읽음')).toHaveLength(3);
  expect(screen.queryByText('원문과 다르게 말한 대사')).not.toBeOnTheScreen();
  await waitFor(() =>
    expect(server.saveProgress).toHaveBeenLastCalledWith('r1', expect.objectContaining({
      complete: true,
      line_results: [
        { line_id: 'l1', said: '그래서 더 말하기 싫었어' },
        { line_id: 'l2', said: '네가 그걸 아니까' },
        { line_id: 'l4', said: '그래서 더 아팠어' },
      ],
    })),
  );
  expect(jest.mocked(enqueueLineRecording).mock.calls.map(([input]) => input.lineId)).toEqual(['l1']);

  await waitFor(() => expect(screen.getByText('빠뜨림 · 여기부터 다시')).toBeEnabled(), { timeout: 2000 });
  await fireEvent.press(screen.getByText('빠뜨림 · 여기부터 다시'));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ start_line_id: 'l3', end_line_id: 'l4' })));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/play');
});

test('SOMA-597: 끝까지 제대로 읽으면 빠뜨린 문장이 없다고 하고 「대사 불일치」를 띄우지 않는다', async () => {
  await startMonologue();
  mockStt.finish.mockResolvedValueOnce('그래서 더 말하기 싫었어 네가 그걸 아니까 나도 내가 얼마나 준비했는지 알아 그래서 더 아팠어');

  await fireEvent.press(screen.getByText('끝내기'));

  expect(await screen.findByText('4문장을 모두 읽었어요.')).toBeOnTheScreen();
  expect(screen.getAllByText('맞게 읽음')).toHaveLength(4);
  expect(screen.queryByText('빠뜨림 · 여기부터 다시')).not.toBeOnTheScreen();
  expect(screen.queryByText('원문과 다르게 말한 대사')).not.toBeOnTheScreen();
});
