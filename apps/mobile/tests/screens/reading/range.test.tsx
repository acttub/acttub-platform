import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';

import ReadingRange from '@/app/reading/range';
import { hasMicPermission, micPermissionGranted } from '@/hooks/use-reading-mic';
import { ApiError } from '@/lib/api-request';
import { getCurrent, resetReadingState } from '@/lib/reading/store';
import * as engine from '@/lib/reading/tts/engine';

import { openFixtureScript, scriptDetail, sessionCard, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('@/hooks/use-reading-mic', () => ({ hasMicPermission: jest.fn(), micPermissionGranted: jest.fn() }));
jest.mock('@/lib/reading/tts/engine', () => ({ prefetchIfWifi: jest.fn(async () => undefined) }));

const TWO_SCENES = scriptDetail(
  [...TWO_ROLE_LINES, ['scene', '2장 거리'], ['dialogue', '서연', '어디 가?'], ['dialogue', '민재', '집에.']],
  {
    scenes: [
      { no: 1, title: '1장 카페', start_line_id: 'l2', end_line_id: 'l5', dialogue_count: 3 },
      { no: 2, title: null, start_line_id: 'l7', end_line_id: 'l8', dialogue_count: 2 },
      { no: 3, title: '사라진 장면', start_line_id: 'gone', end_line_id: 'l8', dialogue_count: 1 },
    ],
  },
);
const LAST_SESSION = {
  id: 'r1',
  status: 'completed' as const,
  my_character_ids: ['c1'],
  my_character_names: ['민재'],
  started_at: '2026-10-19T10:00:00Z',
  ended_at: null,
};

let appStateListeners: ((state: string) => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListeners.push(fn as (state: string) => void);
    return { remove: () => (appStateListeners = appStateListeners.filter((l) => l !== fn)) } as never;
  });
  jest.mocked(hasMicPermission).mockResolvedValue(true);
  jest.mocked(micPermissionGranted).mockResolvedValue(true);
});

async function show(detail = TWO_SCENES) {
  const { server } = await openFixtureScript(detail);
  await render(<ReadingRange />);
  return server;
}

const startButton = (count: number) => screen.getByText(`이 구간 대사 ${count}개 연습하기`);

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingRange />);

  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading');
});

test('처음 연습하는 대본은 대본 전체가 기본 구간이고, 배역을 골라야 시작할 수 있다', async () => {
  await show();

  expect(screen.getByText('봄날의 대화 · 대사 5개')).toBeOnTheScreen();
  expect(screen.queryByText('최근 구간')).not.toBeOnTheScreen();
  expect(screen.getByText('아직 없어요')).toBeOnTheScreen();
  expect(screen.getByText('내 배역을 골라 주세요')).toBeOnTheScreen();
  expect(engine.prefetchIfWifi).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText('민재'));
  expect(screen.queryByText('아직 없어요')).not.toBeOnTheScreen();
  expect(screen.getAllByText('민재')).toHaveLength(2);
  expect(startButton(5)).toBeOnTheScreen();
});

test('배역과 대사 보기를 골라 시작하면 회차를 만들고 대사 보기를 기억한 뒤 실행 화면으로 간다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('서연'));
  await fireEvent.press(screen.getByText('모든 대사 가리기'));

  await fireEvent.press(startButton(5));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/play'));
  expect(server.startSession).toHaveBeenCalledWith('s1', {
    request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    my_character_ids: ['c1', 'c2'],
    mode: 'read',
    start_line_id: 'l2',
    end_line_id: 'l8',
    advance: 'silence',
    record: true,
  });
  expect(getCurrent()?.maskMode).toBe('all');
});

test('고른 배역 칩의 x 를 누르면 그 배역을 뺀다', async () => {
  await show();
  await fireEvent.press(screen.getByText('민재'));

  await fireEvent.press(screen.getAllByText('민재')[1]);
  expect(screen.getByText('아직 없어요')).toBeOnTheScreen();
});

test('장면으로 찾으면 그 장면 안 대사로 구간을 정한다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));

  expect(screen.getByText('대사 3개 · 민재 오늘 왔구나.')).toBeOnTheScreen();
  expect(screen.getByText('장면 2')).toBeOnTheScreen();
  expect(screen.queryByText('사라진 장면')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('장면 2'));
  await fireEvent.press(startButton(2));

  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ start_line_id: 'l7', end_line_id: 'l8' })));
});

test('장면의 첫 줄이 대사가 아니면 그 줄 글을 보인다', async () => {
  await show(scriptDetail(TWO_ROLE_LINES, { scenes: [{ no: 1, title: null, start_line_id: 'l1', end_line_id: 'l5', dialogue_count: 3 }] }));

  expect(screen.getByText('대사 3개 · 1장 카페')).toBeOnTheScreen();
});

test('대사로 찾으면 시작과 끝을 차례로 탭하고, 끝을 시작보다 앞에 찍으면 뒤바꾼다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('대사로 찾기'));

  expect(screen.getByText('① 시작할 대사를 탭하세요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('응, 늦어서 미안해.'));
  expect(screen.getByText('② 끝낼 대사를 탭하세요')).toBeOnTheScreen();
  expect(startButton(4)).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('오늘 왔구나.'));
  expect(screen.getByText('① 시작할 대사를 탭하세요')).toBeOnTheScreen();
  expect(screen.getByText('시작')).toBeOnTheScreen();
  expect(screen.getByText('끝')).toBeOnTheScreen();
  await fireEvent.press(startButton(2));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ start_line_id: 'l2', end_line_id: 'l4' })));
});

test('대사로 찾기에서 끝을 시작 뒤에 찍으면 그 사이가 구간이고, 전체 선택으로 되돌린다', async () => {
  await show();
  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('대사로 찾기'));

  await fireEvent.press(screen.getByText('괜찮아.'));
  await fireEvent.press(screen.getByText('어디 가?'));
  expect(startButton(2)).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('전체 선택'));
  expect(startButton(5)).toBeOnTheScreen();
});

test('연습한 적이 있으면 최근 구간을 먼저 보이고 가장 최근 구간과 지난 배역을 골라 둔다', async () => {
  const startedAt = new Date().toISOString();
  const { server } = await openFixtureScript({ ...TWO_SCENES, last_session: LAST_SESSION });
  server.listSessions.mockResolvedValue({
    sessions: [
      sessionCard({ id: 'r2', ordinal: 2, started_at: startedAt, range: { start_dialogue_no: 4, end_dialogue_no: 5 }, range_name: { kind: 'scene', scene_no: 2, scene_title: null, start: 4, end: 5 } }),
      sessionCard({ id: 'r1', ordinal: 1, started_at: '2026-01-01T00:00:00Z', range: { start_dialogue_no: 4, end_dialogue_no: 5 } }),
      sessionCard({ id: 'r0', ordinal: 0, started_at: '2025-12-31T00:00:00Z', range: { start_dialogue_no: 1, end_dialogue_no: 9 } }),
    ],
  });
  await render(<ReadingRange />);

  expect(screen.getByText('최근 구간')).toBeOnTheScreen();
  expect(await screen.findByText('2개 · 2회차 · 오늘')).toBeOnTheScreen();
  expect(screen.getByText('장면 2')).toBeOnTheScreen();
  expect(screen.getAllByText('민재')).toHaveLength(2);
  expect(server.listSessions).toHaveBeenCalledWith('s1');

  await fireEvent.press(startButton(2));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ my_character_ids: ['c1'], start_line_id: 'l7', end_line_id: 'l8' })));
});

test('최근 구간을 고르면 그 구간으로 바꾼다', async () => {
  const startedAt = new Date().toISOString();
  const { server } = await openFixtureScript({ ...TWO_SCENES, last_session: LAST_SESSION });
  server.listSessions.mockResolvedValue({
    sessions: [
      sessionCard({ id: 'r2', started_at: startedAt, range: { start_dialogue_no: 4, end_dialogue_no: 5 }, range_name: { kind: 'dialogues', scene_no: null, scene_title: null, start: 4, end: 5 } }),
      sessionCard({ id: 'r1', started_at: '2026-01-01T00:00:00Z', range: { start_dialogue_no: 1, end_dialogue_no: 5 } }),
    ],
  });
  await render(<ReadingRange />);
  await screen.findByText('대사 4~5번');

  await fireEvent.press(screen.getByText('처음부터 끝까지'));
  expect(startButton(5)).toBeOnTheScreen();
});

test('회차 목록을 못 불러오면 최근 구간 없이 대본 전체로 시작한다', async () => {
  const { server } = await openFixtureScript({ ...TWO_SCENES, last_session: LAST_SESSION });
  server.listSessions.mockRejectedValue(new Error('offline'));
  await render(<ReadingRange />);

  await waitFor(() => expect(screen.queryByText('최근 구간')).not.toBeOnTheScreen());
  expect(startButton(5)).toBeOnTheScreen();
});

test('회차 상세의 이 구간으로 다시 연습은 넘긴 배역과 구간을 골라 둔다', async () => {
  mockParams = { roles: 'c2,unknown', start: 'l4', end: 'l5' };
  await show();

  expect(screen.getAllByText('서연')).toHaveLength(2);
  expect(startButton(2)).toBeOnTheScreen();
});

test('마이크 권한이 없으면 설정을 열게 하고, 켜고 돌아오면 시작할 수 있다', async () => {
  jest.mocked(hasMicPermission).mockResolvedValue(false);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await show();
  await fireEvent.press(screen.getByText('민재'));

  expect(await screen.findByText('마이크를 켜면 시작할 수 있어요')).toBeOnTheScreen();
  expect(screen.getByText('녹음하려면 설정에서 마이크를 켜 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('설정 열기'));
  expect(openSettings).toHaveBeenCalledTimes(1);

  await act(async () => appStateListeners.forEach((l) => l('background')));
  expect(screen.getByText('마이크를 켜면 시작할 수 있어요')).toBeOnTheScreen();
  await act(async () => appStateListeners.forEach((l) => l('active')));
  expect(await screen.findByText('이 구간 대사 5개 연습하기')).toBeOnTheScreen();
});

test('구간 안에 내 대사가 없으면 서버에 보내지 않고 알린다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('서연'));
  await fireEvent.press(screen.getByText('대사로 찾기'));
  await fireEvent.press(screen.getByText('오늘 왔구나.'));
  await fireEvent.press(screen.getByText('오늘 왔구나.'));

  await fireEvent.press(startButton(1));
  expect(screen.getByText('구간 안에 내 대사가 없어요. 구간이나 배역을 바꿔 주세요.')).toBeOnTheScreen();
  expect(server.startSession).not.toHaveBeenCalled();
});

test.each([
  ['empty_range', '구간 안에 내 대사가 없어요. 구간이나 배역을 바꿔 주세요.'],
  ['invalid_characters', '내 배역을 하나 이상 골라 주세요.'],
  ['script_not_found', 'gone'],
])('서버가 %s 로 거절하면 이유를 알리고 머문다', async (code, message) => {
  const server = await show();
  server.startSession.mockRejectedValue(new ApiError(422, 'gone', code));
  await fireEvent.press(screen.getByText('민재'));

  await fireEvent.press(startButton(5));
  expect(await screen.findByText('연습을 시작하지 못했어요')).toBeOnTheScreen();
  expect(screen.getByText(message)).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(startButton(5)).toBeOnTheScreen();
});

test('시작 요청 중에는 저장 중으로 바꾸고 다시 누를 수 없다', async () => {
  const server = await show();
  let answer: () => void = () => undefined;
  server.startSession.mockImplementation(() => new Promise((resolve) => (answer = () => resolve({} as never))));
  await fireEvent.press(screen.getByText('민재'));

  const pressing = fireEvent.press(startButton(5));
  expect(await screen.findByText('저장 중')).toBeDisabled();
  await fireEvent.press(screen.getByText('저장 중'));
  await act(async () => answer());
  await pressing;
  expect(server.startSession).toHaveBeenCalledTimes(1);
});

test('배역이 하나뿐인 대본은 그 배역을 골라 둔다', async () => {
  await show(scriptDetail([['dialogue', '민재', '혼자야.']]));

  expect(startButton(1)).toBeOnTheScreen();
  expect(screen.queryByText('아직 없어요')).not.toBeOnTheScreen();
});
