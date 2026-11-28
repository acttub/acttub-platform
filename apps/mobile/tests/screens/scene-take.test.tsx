import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SceneTakeScreen from '@/app/scene-take';
import { logEvent } from '@/lib/analytics';
import { takePickedVideo } from '@/lib/practice/picked-video';
import { setRecordScript, takeRecordScript } from '@/lib/practice/record-script';
import { markSceneCoached } from '@/lib/practice/scene-takes';
import { setContinueOrigin } from '@/lib/practice/session-state';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/practice/scene-takes', () => ({ markSceneCoached: jest.fn(async () => ({})) }));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
const mockQueue = jest.fn();
const mockConfirmed = jest.fn();
jest.mock('@/lib/library/library-runner', () => ({
  pendingLibraryUploads: (owner: string) => mockQueue(owner),
  confirmedVideoFor: (id: string) => mockConfirmed(id),
}));
jest.mock('@/lib/reading/store', () => ({}));

const SCRIPT = { title: '햄릿', scriptId: 's1', role: '햄릿', lines: [{ kind: 'dialogue' as const, speaker: '햄릿', text: '사느냐', mine: true }] };
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { pendingId: 'pend1', uri: 'file:///lib/pend1.mov', durationMs: '65000' };
  mockConfirmed.mockReturnValue(null);
  mockQueue.mockResolvedValue([{ id: 'pend1' }]);
  takePickedVideo();
  setRecordScript(SCRIPT);
});

test('「{대본} · {배역} 장면을 찍었어요 (길이)」와 세 버튼을 보인다', async () => {
  await render(<SceneTakeScreen />);
  expect(screen.getByText('햄릿 · 햄릿 장면을 찍었어요 (1:05)')).toBeOnTheScreen();
  expect(screen.getByText('영상은 보관함에도 저장했어요.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '코치에게 보여 주기' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '다시 찍기' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '보관함에 두기' })).toBeOnTheScreen();
});

test('「코치에게 보여 주기」는 올리는 중인 그 영상으로 새 연습 준비를 열고 ③ 코칭 표시를 남긴다', async () => {
  await render(<SceneTakeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '코치에게 보여 주기' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
  expect(takePickedVideo()).toMatchObject({ videoId: null, pendingId: 'pend1', uri: 'file:///lib/pend1.mov', durationMs: 65000 });
  expect(markSceneCoached).toHaveBeenCalledWith('u1', 's1');
  expect(setContinueOrigin).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reading' }));
  expect(logged('scene_take_action')).toEqual([{ action: 'coach' }]);
});

test('이미 확정된 영상이면 확정 id 로 넘기고, 대기 줄에도 없고 id 도 모르면 영상 없이 준비 화면을 연다', async () => {
  mockConfirmed.mockReturnValue('v9');
  const first = await render(<SceneTakeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '코치에게 보여 주기' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
  expect(takePickedVideo()).toMatchObject({ videoId: 'v9', pendingId: null });
  await first.unmount();

  mockConfirmed.mockReturnValue(null);
  mockQueue.mockResolvedValue([]);
  setRecordScript(SCRIPT);
  await render(<SceneTakeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '코치에게 보여 주기' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(2));
  expect(takePickedVideo()).toBeNull();
});

test('「다시 찍기」는 같은 대본으로 카메라를 다시 연다', async () => {
  await render(<SceneTakeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '다시 찍기' }));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'scene', from: 'retake' } });
  expect(takeRecordScript()?.scriptId).toBe('s1');
  expect(logged('scene_take_action')).toEqual([{ action: 'retake' }]);
});

test('「보관함에 두기」·닫기는 연습 탭으로 돌아간다', async () => {
  await render(<SceneTakeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '보관함에 두기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/practice');
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(mockRouter.dismissTo).toHaveBeenCalledTimes(2);
  expect(logged('scene_take_action')).toEqual([{ action: 'keep' }, { action: 'keep' }]);
  expect(markSceneCoached).not.toHaveBeenCalled();
});
