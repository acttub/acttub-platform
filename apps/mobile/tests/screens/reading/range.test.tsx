import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';

import ReadingRange from '@/app/reading/range';
import { micPermissionState, requestMicPermission } from '@/hooks/use-reading-mic';
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
jest.mock('@/hooks/use-reading-mic', () => ({ micPermissionState: jest.fn(), requestMicPermission: jest.fn() }));
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
  jest.mocked(micPermissionState).mockResolvedValue('granted');
  jest.mocked(requestMicPermission).mockResolvedValue('granted');
});

async function show(detail = TWO_SCENES) {
  const { server } = await openFixtureScript(detail);
  await render(<ReadingRange />);
  return server;
}

const startButton = (_count: number) => screen.getByText(/^(연습 시작하기|마이크 켜고 시작하기)$/);

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingRange />);

  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/reading');
});

test('처음 연습하는 대본은 대본 전체가 기본 구간이고, 배역을 골라야 시작할 수 있다', async () => {
  await show();

  expect(screen.getByText('누구로, 어디를 연습할까요?')).toBeOnTheScreen();
  expect(screen.getByText('봄날의 대화 · 대사 5개')).toBeOnTheScreen();
  expect(screen.getByText('구간')).toBeOnTheScreen();
  expect(screen.getByText('내 배역을 골라 주세요')).toBeOnTheScreen();
  expect(engine.prefetchIfWifi).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText('민재'));
  expect(screen.queryByText('내 배역을 골라 주세요')).not.toBeOnTheScreen();
  expect(startButton(5)).toBeOnTheScreen();
});

test('배역과 대사 보기를 골라 시작하면 회차를 만들고 대사 보기를 기억한 뒤 실행 화면으로 간다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('서연'));
  await fireEvent.press(screen.getByText('내 대사만 가리기'));

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
  expect(getCurrent()?.maskMode).toBe('mine');
});

test('고른 배역 카드를 다시 누르면 그 배역을 뺀다', async () => {
  await show();
  await fireEvent.press(screen.getByText('민재'));
  expect(screen.getByRole('checkbox', { name: /^민재 / })).toBeChecked();
  await fireEvent.press(screen.getByText('민재'));
  expect(screen.getByRole('checkbox', { name: /^민재 / })).not.toBeChecked();
});

test('구간 칩에서 장면을 고르면 그 장면 안 대사로 구간을 정한다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('장면 2'));
  await fireEvent.press(startButton(2));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ start_line_id: 'l7', end_line_id: 'l8' })));
  expect(screen.queryByText('장면 3')).not.toBeOnTheScreen();
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

  expect(await screen.findAllByText('장면 2')).not.toHaveLength(0);
  expect(screen.getByRole('checkbox', { name: /^민재 / })).toBeChecked();
  expect(server.listSessions).toHaveBeenCalledWith('s1');

  await fireEvent.press(startButton(2));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ my_character_ids: ['c1'], start_line_id: 'l7', end_line_id: 'l8' })));
});

test('최근 구간 칩을 두고, 처음부터 끝까지를 고르면 그 구간으로 바꾼다', async () => {
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

  expect(startButton(5)).toBeOnTheScreen();
});

test('회차 상세의 이 구간으로 다시 연습은 넘긴 배역과 구간을 골라 둔다', async () => {
  mockParams = { roles: 'c2,unknown', start: 'l4', end: 'l5' };
  await show();

  expect(screen.getByRole('checkbox', { name: /^서연 / })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /^민재 / })).not.toBeChecked();
  expect(startButton(2)).toBeOnTheScreen();
});

test('들어올 때는 마이크를 묻지 않고, 시작을 누르면 OS 창으로 물어 허락하면 시작한다(SOMA-772)', async () => {
  jest.mocked(micPermissionState).mockResolvedValue('ask');
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));
  expect(requestMicPermission).not.toHaveBeenCalled();

  await fireEvent.press(startButton(5));
  expect(requestMicPermission).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/play'));
  expect(server.startSession).toHaveBeenCalledTimes(1);
});

test('OS 창에서 거절하면 시작하지 않고 머물고, 다시 누르면 또 묻는다', async () => {
  jest.mocked(micPermissionState).mockResolvedValue('ask');
  jest.mocked(requestMicPermission).mockResolvedValue('denied');
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));

  await fireEvent.press(startButton(5));
  await fireEvent.press(startButton(5));
  expect(requestMicPermission).toHaveBeenCalledTimes(2);
  expect(server.startSession).not.toHaveBeenCalled();
  expect(screen.queryByText('설정에서 마이크 켜기')).not.toBeOnTheScreen();
});

test('다시 물을 수 없게 거절돼 있으면 시작을 누를 때 설정에서 마이크 켜기 안내와 설정 바로가기를 띄우고, 켜고 돌아오면 시작할 수 있다', async () => {
  jest.mocked(micPermissionState).mockResolvedValue('blocked');
  jest.mocked(requestMicPermission).mockResolvedValue('blocked');
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const server = await show();
  await fireEvent.press(screen.getByText('민재'));

  expect(await screen.findByText('마이크 권한이 필요해요')).toBeOnTheScreen();
  await fireEvent.press(startButton(5));
  expect(await screen.findByText('설정에서 마이크 켜기')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByText('설정 열기').at(-1)!);
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(server.startSession).not.toHaveBeenCalled();

  jest.mocked(micPermissionState).mockResolvedValue('granted');
  await act(async () => appStateListeners.forEach((l) => l('background')));
  expect(screen.getByText('마이크 권한이 필요해요')).toBeOnTheScreen();
  await act(async () => appStateListeners.forEach((l) => l('active')));
  await waitFor(() => expect(screen.queryByText('마이크 권한이 필요해요')).not.toBeOnTheScreen());
  jest.mocked(requestMicPermission).mockResolvedValue('granted');
  await fireEvent.press(startButton(5));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledTimes(1));
});

test('구간 안에 내 대사가 없으면 서버에 보내지 않고 알린다', async () => {
  const server = await show(scriptDetail([['dialogue', '민재', '오늘 왔구나.'], ['dialogue', '서연', '응.']], {
    scenes: [
      { no: 1, title: null, start_line_id: 'l1', end_line_id: 'l1', dialogue_count: 1 },
      { no: 2, title: null, start_line_id: 'l2', end_line_id: 'l2', dialogue_count: 1 },
    ],
  }));
  await fireEvent.press(screen.getByText('서연'));
  await fireEvent.press(screen.getByText('장면 1'));
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
  expect(screen.getByRole('checkbox', { name: /^민재/ })).toBeChecked();
});

test('SOMA-709: 배역 칩은 이름 옆에 대사 수를 보이고, 함께 말하는 줄의 묶음 배역은 칩에 두지 않는다', async () => {
  const detail = scriptDetail([...TWO_ROLE_LINES, ['dialogue', '민재, 서연', '같이 가!']]);
  detail.characters[2] = { ...detail.characters[2], member_ids: ['c1', 'c2'] };
  await show(detail);

  expect(screen.getByRole('checkbox', { name: /^민재 / })).toBeOnTheScreen();
  expect(screen.getByText('2')).toBeOnTheScreen();
  expect(screen.getByText('1')).toBeOnTheScreen();
  expect(screen.queryByRole('checkbox', { name: /^민재, 서연/ })).not.toBeOnTheScreen();
});

test('SOMA-709: 고른 배역의 구간 안 대사가 2줄 이하면 처음 안내 대신 노란 안내를 보이고, 시작은 막지 않는다', async () => {
  const server = await show();
  await fireEvent.press(screen.getByText('서연'));

  expect(screen.getByText('이 구간엔 서연 대사가 2줄뿐이에요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('민재'));
  expect(screen.queryByText(/대사가 \d줄뿐이에요/)).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('민재'));

  await fireEvent.press(startButton(5));
  await waitFor(() => expect(server.startSession).toHaveBeenCalledWith('s1', expect.objectContaining({ my_character_ids: ['c2'] })));
});

test('SOMA-709: 짧은 구간 추천이 뜨는 첫 연습에서도 대사가 적은 배역을 고르면 노란 안내가 그 자리를 대신한다', async () => {
  const lines: Parameters<typeof scriptDetail>[0] = [];
  for (let i = 0; i < 12; i++) lines.push(['dialogue', i === 3 ? '서연' : '민재', `대사 ${i + 1}`]);
  await show(scriptDetail(lines));
  await fireEvent.press(screen.getByText('민재'));
  expect(screen.getByText('처음 10줄 · 추천')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('민재'));
  await fireEvent.press(screen.getByText('서연'));
  expect(screen.getByText('이 구간엔 서연 대사가 1줄뿐이에요')).toBeOnTheScreen();
});

test('SOMA-597: 배역이 하나뿐이면 처음부터 골라져 있고 혼자 하는 대본 안내를 보인다', async () => {
  await show(scriptDetail([
    ['dialogue', '민지', '그래서 더 말하기 싫었어.'],
    ['dialogue', '민지', '네가 그걸 아니까.'],
  ]));

  expect(screen.getByRole('checkbox', { name: /민지/ })).toBeChecked();
  expect(screen.getByText('2문장 · 혼자 하는 대본')).toBeOnTheScreen();
});
