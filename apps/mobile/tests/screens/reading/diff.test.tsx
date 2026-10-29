import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReadingDiff from '@/app/reading/diff';
import { onRecordingQueueChange } from '@/lib/reading/recording-runner';
import { resetReadingState, setLastRunReview } from '@/lib/reading/store';
import type { SessionRecording } from '@/lib/reading/types';

import { openFixtureScript, sessionDetail } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { replace: jest.fn(), dismissTo: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/reading/recording-runner', () => ({ onRecordingQueueChange: jest.fn() }));
type Player = { uri: string; play: jest.Mock; pause: jest.Mock; release: jest.Mock; finish: () => void };
const mockPlayers: Player[] = [];
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn((source: { uri: string }) => {
    let listener: (status: { didJustFinish: boolean }) => void = () => undefined;
    const player = {
      uri: source.uri,
      play: jest.fn(),
      pause: jest.fn(),
      remove: jest.fn(),
      release: jest.fn(),
      addListener: (_event: string, fn: typeof listener) => {
        listener = fn;
      },
      finish: () => listener({ didJustFinish: true }),
    };
    mockPlayers.push(player);
    return player;
  }),
}));

const REC: SessionRecording = {
  id: 'rec5',
  line_id: 'l5',
  attempt_no: 1,
  duration_ms: 1200,
  content_type: 'audio/mp4',
  byte_size: 1000,
  transcript: '괜찮다',
  transcript_source: 'stt',
  playback_url: 'https://cdn.test/rec5.m4a',
  playback_expires_at: '2999-01-01T00:00:00Z',
};
const DIFFERENT = [{ line_id: 'l5', dialogue_no: 3, said: '괜찮다', different_words: [{ text: '괜찮아.', differs: true }] }];

let queueChanged: () => void = () => undefined;
const stopListening = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayers.length = 0;
  jest.mocked(onRecordingQueueChange).mockImplementation((fn) => {
    queueChanged = () => fn(0);
    return stopListening;
  });
});

async function show(recordings: SessionRecording[] = [REC]) {
  const { server } = await openFixtureScript();
  server.getSession.mockResolvedValue(sessionDetail({ recordings }));
  setLastRunReview({ sessionId: 'r1', startIndex: 0, endIndex: 4, myRoles: ['민재'], different: DIFFERENT });
  await render(<ReadingDiff />);
  return server;
}

test('완료 화면의 결과가 없으면 대본이 없다고 알리고 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingDiff />);

  expect(screen.getByText('대본이 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading');
});

test('구간 대본을 순서대로 보이고, 다르게 말한 내 줄에는 말한 것과 내 녹음을 붙인다', async () => {
  const server = await show();

  expect(await screen.findByText('내 녹음')).toBeOnTheScreen();
  expect(screen.getByText('1장 카페')).toBeOnTheScreen();
  expect(screen.getByText('(서연이 자리에 앉는다.)')).toBeOnTheScreen();
  expect(screen.getByText('오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.getByText('응, 늦어서 미안해.')).toBeOnTheScreen();
  expect(screen.getByText('괜찮다')).toBeOnTheScreen();
  expect(screen.getAllByText('내 녹음')).toHaveLength(1);
  expect(server.getSession).toHaveBeenCalledWith('r1');
});

test('내 녹음을 누르면 틀고, 다시 누르면 멈춘다', async () => {
  await show();

  await fireEvent.press(await screen.findByText('내 녹음'));
  expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/rec5.m4a']);
  expect(mockPlayers[0].play).toHaveBeenCalled();

  await fireEvent.press(screen.getByText('내 녹음'));
  expect(mockPlayers[0].release).toHaveBeenCalled();
  expect(mockPlayers).toHaveLength(1);
});

test('다 들은 뒤 다시 누르면 처음부터 다시 튼다', async () => {
  await show();
  await fireEvent.press(await screen.findByText('내 녹음'));

  await act(async () => mockPlayers[0].finish());
  await fireEvent.press(screen.getByText('내 녹음'));
  expect(mockPlayers).toHaveLength(2);
});

test('재생 주소가 만료됐으면 회차를 다시 불러 새 주소로 튼다', async () => {
  const server = await show([{ ...REC, playback_expires_at: '2000-01-01T00:00:00Z' }]);
  await screen.findByText('내 녹음');
  server.getSession.mockResolvedValue(sessionDetail({ recordings: [{ ...REC, playback_url: 'https://cdn.test/fresh.m4a' }] }));

  await fireEvent.press(screen.getByText('내 녹음'));
  expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/fresh.m4a']);
});

test('다시 불러도 재생 주소가 없으면 틀지 않는다', async () => {
  const server = await show([{ ...REC, playback_expires_at: '2000-01-01T00:00:00Z' }]);
  await screen.findByText('내 녹음');
  server.getSession.mockRejectedValue(new Error('offline'));

  await fireEvent.press(screen.getByText('내 녹음'));
  expect(mockPlayers).toHaveLength(0);
});

test('올리는 중이던 녹음은 올리기 큐가 바뀌면 다시 불러 내 녹음 버튼을 붙인다', async () => {
  const server = await show([]);
  await waitFor(() => expect(server.getSession).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('내 녹음')).not.toBeOnTheScreen();

  server.getSession.mockResolvedValue(sessionDetail({ recordings: [REC] }));
  await act(async () => queueChanged());
  expect(await screen.findByText('내 녹음')).toBeOnTheScreen();
});

test('화면을 떠나면 틀던 녹음을 멈추고 큐 구독을 끊는다', async () => {
  await show();
  await fireEvent.press(await screen.findByText('내 녹음'));

  await screen.unmount();
  expect(mockPlayers[0].release).toHaveBeenCalled();
  expect(stopListening).toHaveBeenCalledTimes(1);
});
