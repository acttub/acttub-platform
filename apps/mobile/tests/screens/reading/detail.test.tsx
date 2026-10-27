import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReadingDetail from '@/app/reading/detail';
import { ApiError } from '@/lib/api-request';
import { getCurrent, resetReadingState } from '@/lib/reading/store';

import { openFixtureScript, scriptDetail, sessionCard, TWO_ROLE_LINES } from './fixtures';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
const mockRouter = { dismissTo: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    Stack: { Screen: ({ options }: { options: { headerRight?: () => unknown } }) => options.headerRight?.() ?? null },
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    useRouter: () => mockRouter,
  };
});
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: require('react-native').View }));
const mockSwipeClose = jest.fn();
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { createElement, forwardRef, useImperativeHandle } = require('react');
  const { View } = require('react-native');
  // 밀기 제스처는 jest 에서 낼 수 없어, 밀어서 드러난 [삭제]까지 함께 그린다.
  const Swipeable = forwardRef(
    ({ children, renderRightActions }: { children: unknown; renderRightActions: () => unknown }, ref: unknown) => {
      useImperativeHandle(ref, () => ({ close: mockSwipeClose }));
      return createElement(View, null, children, renderRightActions());
    },
  );
  return { __esModule: true, default: Swipeable };
});

beforeEach(() => {
  jest.clearAllMocks();
});

async function show(sessions = [sessionCard({ started_at: new Date().toISOString() })]) {
  const { server } = await openFixtureScript();
  server.listSessions.mockResolvedValue({ sessions });
  await render(<ReadingDetail />);
  return server;
}

test('현재 대본이 없으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  resetReadingState();
  await render(<ReadingDetail />);

  await fireEvent.press(screen.getByText('내 대본으로'));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading');
});

test('서버에서 대본이 사라졌으면 내 대본으로 돌아가는 길을 보여 준다', async () => {
  const { server } = await openFixtureScript();
  server.get.mockRejectedValue(new ApiError(404, 'gone', 'script_not_found'));
  await render(<ReadingDetail />);

  expect(await screen.findByText('대본이 없어요')).toBeOnTheScreen();
});

test('대본 제목·대사 수와 연습 기록을 보이고, 회차를 누르면 회차 상세로 간다', async () => {
  const server = await show();

  expect(await screen.findByText('1회차')).toBeOnTheScreen();
  expect(screen.getByText('봄날의 대화')).toBeOnTheScreen();
  expect(screen.getByText('3개 대사')).toBeOnTheScreen();
  expect(screen.getByText('오늘')).toBeOnTheScreen();
  expect(screen.getByText('처음부터 끝까지')).toBeOnTheScreen();
  expect(screen.getByText('민재 · 녹음 0개 · 1:05')).toBeOnTheScreen();
  expect(screen.getByText('진행 중 · 1/3')).toBeOnTheScreen();
  expect(server.listSessions).toHaveBeenCalledWith('s1');

  await fireEvent.press(screen.getByText('1회차'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/reading/session', params: { id: 'r1' } });
});

test('연습 기록이 없으면 첫 연습을 권하고, 대본 보기와 연습하기로 이어 간다', async () => {
  await show([]);

  expect(await screen.findByText('아직 연습 기록이 없어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('대본 보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/full');
  await fireEvent.press(screen.getByText('연습하기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/range');
});

test('연습 기록을 못 불러오면 빈 기록으로 보인다', async () => {
  const { server } = await openFixtureScript();
  server.listSessions.mockRejectedValue(new Error('offline'));
  await render(<ReadingDetail />);

  expect(await screen.findByText('아직 연습 기록이 없어요')).toBeOnTheScreen();
});

test('회차를 밀어 삭제하면 확인을 받고 지운 뒤 목록을 다시 불러온다', async () => {
  const server = await show();
  await screen.findByText('1회차');
  server.listSessions.mockResolvedValue({ sessions: [] });

  await fireEvent.press(screen.getByText('삭제'));
  expect(mockSwipeClose).toHaveBeenCalled();
  expect(screen.getByText('회차를 삭제할까요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByText('삭제').at(-1)!);

  expect(await screen.findByText('아직 연습 기록이 없어요')).toBeOnTheScreen();
  expect(server.deleteSession).toHaveBeenCalledWith('r1');
});

test('회차 삭제를 취소하면 지우지 않는다', async () => {
  const server = await show();
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByText('삭제'));
  await fireEvent.press(screen.getByText('취소'));
  expect(server.deleteSession).not.toHaveBeenCalled();
  expect(screen.getByText('1회차')).toBeOnTheScreen();
});

test('회차를 지우지 못하면 이유를 알린다', async () => {
  const server = await show();
  server.deleteSession.mockRejectedValue(new ApiError(404, '회차가 없어요', 'session_not_found'));
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByText('삭제'));
  await fireEvent.press(screen.getAllByText('삭제').at(-1)!);
  expect(await screen.findByText('회차가 없어요')).toBeOnTheScreen();
});

test('더보기의 제목 수정으로 제목을 바꾸면 서버에 보내고 새 제목을 보인다', async () => {
  const server = await show();
  server.patch.mockResolvedValue(scriptDetail(TWO_ROLE_LINES, { title: '여름의 대화' }));
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('제목 수정'));
  await fireEvent.changeText(screen.getByDisplayValue('봄날의 대화'), '여름의 대화');
  await fireEvent.press(screen.getByText('저장'));

  expect(await screen.findByText('여름의 대화')).toBeOnTheScreen();
  expect(server.patch).toHaveBeenCalledWith('s1', { title: '여름의 대화' });
  expect(getCurrent()?.title).toBe('여름의 대화');
});

test('제목 수정을 취소하면 그대로 둔다', async () => {
  const server = await show();
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('제목 수정'));
  await fireEvent.press(screen.getByText('취소'));

  expect(screen.queryByDisplayValue('봄날의 대화')).not.toBeOnTheScreen();
  expect(server.patch).not.toHaveBeenCalled();
});

test('더보기의 목소리 바꾸기는 목소리 정하기를 연다', async () => {
  await show();
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('목소리 바꾸기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/reading/roles');
});

test('더보기의 대본 삭제는 확인을 받고 대본을 지운 뒤 내 대본으로 간다', async () => {
  const server = await show();
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('대본 삭제'));
  expect(screen.getByText('녹음과 연습 기록이 함께 지워지고 되돌릴 수 없어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getAllByText('삭제').at(-1)!);

  await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/reading'));
  expect(server.remove).toHaveBeenCalledWith('s1');
  expect(getCurrent()).toBeNull();
});

test('대본 삭제를 취소하면 지우지 않는다', async () => {
  const server = await show();
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('대본 삭제'));
  await fireEvent.press(screen.getByText('취소'));
  expect(server.remove).not.toHaveBeenCalled();
});

test('대본을 지우지 못하면 이유를 알린다', async () => {
  const server = await show();
  server.remove.mockRejectedValue(new ApiError(500, '서버가 잠시 멈췄어요'));
  await screen.findByText('1회차');

  await fireEvent.press(screen.getByLabelText('더보기'));
  await fireEvent.press(screen.getByText('대본 삭제'));
  await fireEvent.press(screen.getAllByText('삭제').at(-1)!);

  expect(await screen.findByText('서버가 잠시 멈췄어요')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
