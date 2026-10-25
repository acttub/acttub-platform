import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';

import ReadingSession from '@/app/reading/session';
import { ApiError } from '@/lib/api-request';
import { getCurrentSession, resetReadingState } from '@/lib/reading/store';
import type { SessionRecording } from '@/lib/reading/types';

import { openFixtureScript, sessionDetail } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { dismissTo: jest.fn(), replace: jest.fn(), push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    Stack: { Screen: ({ options }: { options: { headerRight?: () => unknown } }) => options.headerRight?.() ?? null },
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    useLocalSearchParams: () => ({ id: 'r1' }),
    useRouter: () => mockRouter,
  };
});
type Player = {
  uri: string;
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  release: jest.Mock;
  finish: () => void;
};
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

const FUTURE = '2999-01-01T00:00:00Z';
function recording(over: Partial<SessionRecording>): SessionRecording {
  return {
    id: 'rec1',
    line_id: 'l2',
    attempt_no: 1,
    duration_ms: 1500,
    content_type: 'audio/mp4',
    byte_size: 1000,
    transcript: null,
    transcript_source: 'none',
    playback_url: 'https://cdn.test/rec1.m4a',
    playback_expires_at: FUTURE,
    ...over,
  };
}
const RECORDINGS = [
  recording({ id: 'old', attempt_no: 1, playback_url: 'https://cdn.test/old.m4a' }),
  recording({ id: 'rec1', attempt_no: 2 }),
  recording({ id: 'rec5', line_id: 'l5', duration_ms: 65_000, playback_url: 'https://cdn.test/rec5.m4a' }),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayers.length = 0;
});

async function show(detail = sessionDetail({ started_at: new Date().toISOString(), recordings: RECORDINGS })) {
  const { server } = await openFixtureScript();
  server.getSession.mockResolvedValue(detail);
  await render(<ReadingSession />);
  return server;
}

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingSession />);

  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading');
});

test('회차를 못 불러오면 알리고 다시 시도로 불러온다', async () => {
  const { server } = await openFixtureScript();
  server.getSession.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(sessionDetail());
  await render(<ReadingSession />);

  expect(await screen.findByText('회차를 불러오지 못했어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));
  expect(await screen.findByText('처음부터 끝까지')).toBeOnTheScreen();
  expect(server.getSession).toHaveBeenCalledWith('r1');
});

test('진행 중 회차는 구간·배역·시간과 이어 할 줄을 보이고, 이어서 연습으로 실행 화면을 연다', async () => {
  const detail = sessionDetail({
    started_at: new Date().toISOString(),
    current_line_id: 'l4',
    progress: { done: 1, total: 3 },
    different_lines: [{ line_id: 'l2', dialogue_no: 1, said: '오늘 왔니', different_words: [{ text: '오늘', differs: false }, { text: '왔구나.', differs: true }] }],
  });
  await show(detail);

  expect(await screen.findByText('처음부터 끝까지')).toBeOnTheScreen();
  expect(screen.getByText('민재 · 오늘 · 1:05')).toBeOnTheScreen();
  expect(screen.getByText('진행 중 · 1/3')).toBeOnTheScreen();
  expect(screen.getByText('(서연이 자리에 앉는다.)')).toBeOnTheScreen();
  expect(screen.getByText('여기부터 이어서')).toBeOnTheScreen();
  expect(screen.getByText('오늘 왔니')).toBeOnTheScreen();
  expect(screen.queryByText('전체 듣기')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('이어서 연습 · 1/3줄'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/play');
  expect(getCurrentSession()).toEqual(detail);
});

test('끝난 회차는 같은 배역·구간으로 새 연습을 연다', async () => {
  await show(sessionDetail({ status: 'completed', progress: null, ended_at: '2026-10-19T10:10:00Z', range_name: { kind: 'dialogues', scene_no: null, scene_title: null, start: 1, end: 3 } }));

  expect(await screen.findByText('대사 1~3번')).toBeOnTheScreen();
  expect(screen.getByText('완료')).toBeOnTheScreen();
  expect(screen.queryByText('여기부터 이어서')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('이 구간으로 다시 연습'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/reading/range', params: { roles: 'c1', start: 'l2', end: 'l5' } });
});

test('진행 수를 모르는 진행 중 회차는 진행 중만 보이고 다시 연습을 준다', async () => {
  await show(sessionDetail({ progress: null }));

  expect(await screen.findByText('진행 중')).toBeOnTheScreen();
  expect(screen.getByText('이 구간으로 다시 연습')).toBeOnTheScreen();
});

test('내 녹음만 보면 줄마다 마지막 시도의 번호·길이를 보이고, 녹음이 없으면 안내한다', async () => {
  await show();
  await screen.findByText('처음부터 끝까지');

  await fireEvent.press(screen.getByText('내 녹음만'));
  expect(screen.getByText('1번 대사 · 0:01')).toBeOnTheScreen();
  expect(screen.getByText('3번 대사 · 1:05')).toBeOnTheScreen();
  expect(screen.queryByText('서연이 자리에 앉는다.')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('구간 전체'));
  expect(screen.getByText('(서연이 자리에 앉는다.)')).toBeOnTheScreen();
});

test('녹음이 하나도 없으면 내 녹음만에 이유를 보인다', async () => {
  await show(sessionDetail({ recordings: [] }));
  await screen.findByText('처음부터 끝까지');

  await fireEvent.press(screen.getByText('내 녹음만'));
  expect(screen.getByText('이 회차에는 녹음이 없어요')).toBeOnTheScreen();
  expect(screen.getByText('내 대사를 말하지 않고 넘겼거나 녹음을 저장하지 못했어요.')).toBeOnTheScreen();
});

test('줄의 재생을 누르면 마지막 시도를 틀고, 다시 누르면 멈춘다', async () => {
  await show();
  await screen.findByText('전체 듣기');
  await fireEvent.press(screen.getByText('내 녹음만'));

  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[0]);
  expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/rec1.m4a']);
  expect(mockPlayers[0].play).toHaveBeenCalled();
  expect(screen.getByText('1번 대사 · 0:01 · 재생 중')).toBeOnTheScreen();

  await fireEvent.press(screen.getByLabelText('재생 중'));
  expect(mockPlayers[0].release).toHaveBeenCalled();
  expect(screen.getByText('1번 대사 · 0:01')).toBeOnTheScreen();
});

test('재생이 끝나면 재생 중 표시를 지운다', async () => {
  await show();
  await screen.findByText('전체 듣기');

  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[1]);
  expect(screen.getByLabelText('재생 중')).toBeOnTheScreen();
  await act(async () => mockPlayers[0].finish());
  expect(screen.queryByLabelText('재생 중')).not.toBeOnTheScreen();
});

test('재생 주소가 만료됐으면 회차를 다시 불러 새 주소로 튼다', async () => {
  const server = await show(sessionDetail({ recordings: [recording({ playback_expires_at: '2000-01-01T00:00:00Z' })] }));
  await screen.findByText('전체 듣기');
  server.getSession.mockResolvedValue(sessionDetail({ recordings: [recording({ playback_url: 'https://cdn.test/fresh.m4a' })] }));

  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[0]);
  await waitFor(() => expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/fresh.m4a']));
  expect(server.getSession).toHaveBeenCalledTimes(2);
});

test('다시 불러도 재생 주소가 없으면 재생하지 못했다고 알린다', async () => {
  const server = await show(sessionDetail({ recordings: [recording({ playback_expires_at: '2000-01-01T00:00:00Z' })] }));
  await screen.findByText('전체 듣기');
  server.getSession.mockResolvedValue(sessionDetail({ recordings: [recording({ playback_url: null })] }));

  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[0]);
  expect(await screen.findByText('재생하지 못했어요. 목록을 다시 불러왔어요.')).toBeOnTheScreen();
  expect(mockPlayers).toHaveLength(0);
});

test('주소를 다시 받는 사이 다른 줄을 틀면 앞 줄은 틀지 않는다', async () => {
  const server = await show(sessionDetail({ recordings: [recording({ playback_expires_at: '2000-01-01T00:00:00Z' }), recording({ id: 'rec5', line_id: 'l5', playback_url: 'https://cdn.test/rec5.m4a' })] }));
  await screen.findByText('전체 듣기');
  let reload: () => void = () => undefined;
  server.getSession.mockImplementation(() => new Promise((resolve) => (reload = () => resolve(sessionDetail({ recordings: [recording({})] })))));

  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[0]);
  await fireEvent.press(screen.getAllByLabelText('전체 듣기')[1]);
  await act(async () => reload());

  expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/rec5.m4a']);
  expect(screen.queryByText('재생하지 못했어요. 목록을 다시 불러왔어요.')).not.toBeOnTheScreen();
});

test('전체 듣기는 내 녹음을 줄 순서로 이어 틀고, 끝나면 처음 글로 돌아온다', async () => {
  await show();
  await fireEvent.press(await screen.findByText('전체 듣기'));

  expect(screen.getByText('멈춤 · 1 / 2')).toBeOnTheScreen();
  await act(async () => mockPlayers[0].finish());
  expect(screen.getByText('멈춤 · 2 / 2')).toBeOnTheScreen();
  await act(async () => mockPlayers[1].finish());
  expect(screen.getByText('전체 듣기')).toBeOnTheScreen();
  expect(mockPlayers.map((p) => p.uri)).toEqual(['https://cdn.test/rec1.m4a', 'https://cdn.test/rec5.m4a']);
});

test('전체 듣기 중에 누르면 멈춘다', async () => {
  await show();
  await fireEvent.press(await screen.findByText('전체 듣기'));

  await fireEvent.press(screen.getByText('멈춤 · 1 / 2'));
  expect(screen.getByText('전체 듣기')).toBeOnTheScreen();
  expect(mockPlayers[0].pause).toHaveBeenCalled();
});

test('전체 듣기 중 재생 주소를 못 받으면 재생하지 못했다고 알린다', async () => {
  const server = await show(sessionDetail({ recordings: [recording({ playback_expires_at: '2000-01-01T00:00:00Z' })] }));
  server.getSession.mockResolvedValue(sessionDetail({ recordings: [] }));

  await fireEvent.press(await screen.findByText('전체 듣기'));
  expect(await screen.findByText('재생하지 못했어요. 목록을 다시 불러왔어요.')).toBeOnTheScreen();
});

test('더보기에서 회차를 지우면 확인을 받은 뒤 지우고 돌아간다', async () => {
  const server = await show();
  await fireEvent.press(await screen.findByLabelText('더보기'));
  expect(screen.getByText('1회차')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('회차 삭제'));
  expect(await screen.findByText('회차를 삭제할까요?')).toBeOnTheScreen();
  expect(screen.getByText('이 회차의 녹음도 함께 지워져요. 외운 대사 표시는 남아요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('삭제'));

  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
});

test('회차 삭제 확인을 취소하면 지우지 않는다', async () => {
  const server = await show();
  await fireEvent.press(await screen.findByLabelText('더보기'));
  await fireEvent.press(screen.getByText('회차 삭제'));

  await fireEvent.press(await screen.findByText('취소'));
  expect(server.deleteSession).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('회차를 지우지 못하면 이유를 알린다', async () => {
  const server = await show();
  server.deleteSession.mockRejectedValue(new ApiError(404, '회차가 없어요', 'session_not_found'));
  await fireEvent.press(await screen.findByLabelText('더보기'));
  await fireEvent.press(screen.getByText('회차 삭제'));

  await fireEvent.press(await screen.findByText('삭제'));
  expect(await screen.findByText('회차가 없어요')).toBeOnTheScreen();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('화면을 떠나면 틀던 녹음을 멈춘다', async () => {
  await show();
  await fireEvent.press(await screen.findByText('전체 듣기'));

  await screen.unmount();
  expect(mockPlayers[0].release).toHaveBeenCalled();
});

test('구간이 장면 줄부터 시작하면 장면 이름도 대본에 보인다', async () => {
  await show(sessionDetail({ start_line_id: 'l1' }));

  expect(await screen.findByText('1장 카페')).toBeOnTheScreen();
});
