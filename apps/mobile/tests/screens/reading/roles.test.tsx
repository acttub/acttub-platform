import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import ReadingRoles from '@/app/reading/roles';
import { api } from '@/lib/api';
import { resetReadingState } from '@/lib/reading/store';
import { assetsPresent } from '@/lib/reading/tts/assets';
import * as engine from '@/lib/reading/tts/engine';
import { cloudVoiceSampleUri } from '@/lib/reading/voice-samples';
import { endTutorial, startTutorial } from '@/lib/tutorial';

import { openFixtureScript, scriptDetail, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/api', () => ({ api: { getCloudVoiceStatus: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(async () => undefined) }));
jest.mock('@/lib/reading/tts/engine', () => ({
  prefetchIfWifi: jest.fn(async () => undefined),
  stop: jest.fn(),
  play: jest.fn(),
  isReady: jest.fn(),
  ensureReady: jest.fn(),
  preview: jest.fn(),
}));
jest.mock('@/lib/reading/tts/assets', () => ({ activeVariant: () => 'fp32', assetsPresent: jest.fn() }));
jest.mock('@/lib/reading/voice-samples', () => ({ cloudVoiceSampleUri: jest.fn() }));

let appStateListeners: ((state: string) => void)[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  endTutorial();
  mockParams = {};
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListeners.push(fn as (state: string) => void);
    return { remove: () => (appStateListeners = appStateListeners.filter((l) => l !== fn)) } as never;
  });
  jest.mocked(api.getCloudVoiceStatus).mockRejectedValue(new Error('offline'));
  jest.mocked(engine.isReady).mockReturnValue(true);
  jest.mocked(engine.ensureReady).mockResolvedValue(undefined);
  jest.mocked(engine.preview).mockResolvedValue(undefined);
  jest.mocked(engine.play).mockResolvedValue(undefined);
  jest.mocked(assetsPresent).mockReturnValue(true);
});

async function show(detail = scriptDetail(TWO_ROLE_LINES)) {
  const { server } = await openFixtureScript(detail);
  await render(<ReadingRoles />);
  return server;
}

const previewButtons = () => screen.getAllByLabelText('미리 듣기');

test('현재 대본이 없으면 대본 넣기로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingRoles />);

  await fireEvent.press(screen.getByText('대본 넣기로'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/new');
});

test('배역마다 대사 수와 서버가 정한 목소리를 보이고, 전체 보기로 대본을 연다', async () => {
  await show();

  expect(screen.getByText('배역 2명 · 대사 3줄')).toBeOnTheScreen();
  expect(screen.getByText('대사 2줄')).toBeOnTheScreen();
  expect(screen.getByText('대사 1줄')).toBeOnTheScreen();
  expect(screen.getByText('남성 · 밝은 청년')).toBeOnTheScreen();
  expect(screen.getByText('여성 · 또렷한 성인')).toBeOnTheScreen();
  expect(engine.prefetchIfWifi).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText('전체 보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/full');
});

test('목소리를 고르면 그 목소리로 미리 들려주고, 저장하면 바꾼 배역만 서버에 보낸 뒤 돌아간다', async () => {
  const server = await show();

  await fireEvent.press(screen.getByText('남성 · 밝은 청년'));
  // 시트 대신 그 배역 줄 아래에 펼쳐진다(SOMA-821).
  expect(screen.getByText(/^추천 목소리/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('묵직한 노년'));
  await waitFor(() => expect(engine.preview).toHaveBeenCalledWith('M5'));
  // 고르면 접힌다.
  expect(screen.queryByText(/^추천 목소리/)).not.toBeOnTheScreen();
  expect(screen.getByText('남성 · 묵직한 노년')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('저장'));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(server.patch).toHaveBeenCalledWith('s1', { characters: [{ id: 'c1', voice_preset: 'M5' }] });
});

test('고정한 목소리를 추천 목소리로 되돌리면 자동으로 저장한다', async () => {
  const detail = scriptDetail(TWO_ROLE_LINES);
  detail.characters[0] = { ...detail.characters[0], voice_preset: 'M5', voice: 'M5' };
  const server = await show(detail);

  await fireEvent.press(screen.getByText('남성 · 묵직한 노년'));
  await fireEvent.press(screen.getByText('추천 목소리 (여성 · 또렷한 성인)'));

  await fireEvent.press(screen.getByText('저장'));
  await waitFor(() => expect(server.patch).toHaveBeenCalledWith('s1', { characters: [{ id: 'c1', voice_preset: null }] }));
});

test('바꾼 것이 없으면 서버에 보내지 않고 돌아간다', async () => {
  const server = await show();

  await fireEvent.press(screen.getByText('저장'));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(server.patch).not.toHaveBeenCalled();
});

test('대본 넣기에서 왔으면 저장 뒤 대본 상세로 간다', async () => {
  mockParams = { from: 'new' };
  await show();

  await fireEvent.press(screen.getByText('저장'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail');
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('리딩 튜토리얼 중이면 저장 뒤 대본 상세를 거쳐 새 연습으로 간다', async () => {
  mockParams = { from: 'new' };
  startTutorial('sample', 'reading');
  await show();

  await fireEvent.press(screen.getByText('저장'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail');
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/range');
});

test('저장에 실패하면 알리고 고른 목소리를 그대로 두어 다시 저장할 수 있다', async () => {
  const server = await show();
  server.patch.mockRejectedValueOnce(new Error('offline'));
  await fireEvent.press(screen.getByText('여성 · 또렷한 성인'));
  await fireEvent.press(screen.getByText('따뜻한 노년'));

  await fireEvent.press(screen.getByText('저장'));
  expect(await screen.findByText('목소리를 저장하지 못했어요. 고른 목소리는 그대로 두었으니 다시 저장해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('확인'));
  expect(screen.getByText('여성 · 따뜻한 노년')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('저장'));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(server.patch).toHaveBeenLastCalledWith('s1', { characters: [{ id: 'c2', voice_preset: 'F5' }] });
});

test('저장하는 동안은 버튼이 저장 중으로 바뀐다', async () => {
  const server = await show();
  let answer: () => void = () => undefined;
  server.patch.mockImplementation(() => new Promise((resolve) => (answer = () => resolve(scriptDetail(TWO_ROLE_LINES)))));
  await fireEvent.press(screen.getByText('남성 · 밝은 청년'));
  await fireEvent.press(screen.getByText('낮은 중년'));

  const saving = fireEvent.press(screen.getByText('저장'));
  expect(await screen.findByText('저장 중…')).toBeOnTheScreen();
  await act(async () => answer());
  await saving;
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('미리 듣기를 누르면 듣는 중으로 바뀌고, 다시 누르면 멈춘다', async () => {
  let finish: () => void = () => undefined;
  jest.mocked(engine.preview).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  await show();

  await fireEvent.press(previewButtons()[0]);
  expect(await screen.findByText('미리 듣는 중…')).toBeOnTheScreen();
  expect(engine.preview).toHaveBeenCalledWith('M1');

  await fireEvent.press(previewButtons()[0]);
  expect(screen.queryByText('미리 듣는 중…')).not.toBeOnTheScreen();
  await act(async () => finish());
  expect(screen.getByText('대사 2줄')).toBeOnTheScreen();
});

test('미리 듣기가 끝나면 듣는 중 표시를 지운다', async () => {
  await show();

  await fireEvent.press(previewButtons()[1]);
  await waitFor(() => expect(engine.preview).toHaveBeenCalledWith('F1'));
  expect(screen.queryByText('미리 듣는 중…')).not.toBeOnTheScreen();
});

test('목소리 모델이 아직 없으면 미리 듣기 대신 준비되지 않았다고 알린다', async () => {
  jest.mocked(engine.isReady).mockReturnValue(false);
  jest.mocked(assetsPresent).mockReturnValue(false);
  await show();

  await fireEvent.press(previewButtons()[0]);
  expect(await screen.findByText('음성 엔진이 준비되지 않았어요')).toBeOnTheScreen();
  expect(engine.ensureReady).not.toHaveBeenCalled();
});

test('미리 듣기를 못 하면 준비되지 않았다고 알린다', async () => {
  jest.mocked(engine.ensureReady).mockRejectedValue(new Error('bad model'));
  await show();

  await fireEvent.press(previewButtons()[0]);
  expect(await screen.findByText('음성 엔진이 준비되지 않았어요')).toBeOnTheScreen();
});

test('고품질 목소리를 쓰는 중이면 앱에 넣은 샘플로 미리 듣는다', async () => {
  await AsyncStorage.setItem('acttub.cloudVoice', 'on');
  jest.mocked(api.getCloudVoiceStatus).mockResolvedValue({ available: true, free_until: null, consent: 'granted', daily_limit: 10, daily_used: 0 });
  jest.mocked(cloudVoiceSampleUri).mockResolvedValue('file:///voice-preview-f1.m4a');
  await show();

  await fireEvent.press(previewButtons()[1]);
  await waitFor(() => expect(engine.play).toHaveBeenCalledWith('file:///voice-preview-f1.m4a'));
  expect(cloudVoiceSampleUri).toHaveBeenCalledWith('F1');
  expect(engine.preview).not.toHaveBeenCalled();
});

test('앞 미리 듣기를 기다리는 사이 다른 배역을 누르면 앞 것은 틀지 않는다', async () => {
  let readyFirst: () => void = () => undefined;
  jest.mocked(engine.ensureReady).mockImplementationOnce(() => new Promise<void>((resolve) => (readyFirst = resolve)));
  jest.mocked(engine.preview).mockImplementation(() => new Promise<void>(() => undefined));
  await show();

  await fireEvent.press(previewButtons()[0]);
  await fireEvent.press(previewButtons()[1]);
  await act(async () => readyFirst());

  expect(jest.mocked(engine.preview).mock.calls).toEqual([['F1']]);
  expect(screen.getByText('미리 듣는 중…')).toBeOnTheScreen();
});

test('앱을 내리면 미리 듣기를 멈춘다', async () => {
  jest.mocked(engine.preview).mockImplementation(() => new Promise<void>(() => undefined));
  await show();
  await fireEvent.press(previewButtons()[0]);
  expect(await screen.findByText('미리 듣는 중…')).toBeOnTheScreen();

  await act(async () => appStateListeners.forEach((l) => l('active')));
  expect(screen.getByText('미리 듣는 중…')).toBeOnTheScreen();
  await act(async () => appStateListeners.forEach((l) => l('background')));
  expect(screen.queryByText('미리 듣는 중…')).not.toBeOnTheScreen();
  expect(engine.stop).toHaveBeenCalled();
});

test('자동 목소리를 받을 수 없는 배역은 미리 듣기를 하지 않는다', async () => {
  const detail = scriptDetail(TWO_ROLE_LINES);
  detail.characters[0] = { ...detail.characters[0], voice: 'custom' };
  await show(detail);

  expect(screen.getByText('-')).toBeOnTheScreen();
  await fireEvent.press(previewButtons()[0]);
  expect(screen.queryByText('미리 듣는 중…')).not.toBeOnTheScreen();
  expect(engine.preview).not.toHaveBeenCalled();
});

test('목소리 칩을 다시 누르면 고르지 않고 펼친 칸이 접힌다', async () => {
  await show();
  await fireEvent.press(screen.getByText('남성 · 밝은 청년'));
  expect(screen.getByText(/^추천 목소리/)).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('남성 · 밝은 청년'));
  expect(screen.queryByText(/^추천 목소리/)).not.toBeOnTheScreen();
  expect(screen.getByText('남성 · 밝은 청년')).toBeOnTheScreen();
});
