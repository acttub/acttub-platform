import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';

import ReadingList from '@/app/(tabs)/reading';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { addSplitJob, readSplitJobs } from '@/lib/reading/split-jobs';
import { listScripts } from '@/lib/reading/store';
import type { ScriptCard, ScriptImport } from '@/lib/reading/types';
import { rememberSkeletonHints } from '@/lib/skeleton-hint';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: storage };
});
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getScriptImport: jest.fn() } }));
jest.mock('@/lib/reading/store', () => ({
  listScripts: jest.fn(),
  deleteScript: jest.fn(),
  loadIntoCurrent: jest.fn(),
  listSessions: jest.fn(async () => []),
  fetchSession: jest.fn(),
  setCurrentSession: jest.fn(),
}));
jest.mock('@/lib/guide-state', () => ({
  hasSeenReadingTutorial: jest.fn(async () => true),
  hasSeenSpotlight: jest.fn(async () => true),
  markReadingTutorialSeen: jest.fn(async () => undefined),
  markSpotlightSeen: jest.fn(async () => undefined),
  markTutorialSeen: jest.fn(async () => undefined),
}));
jest.mock('@/hooks/use-cloud-voice', () => ({
  useCloudVoice: () => ({ status: null, enabled: false, busy: false, enable: jest.fn(), disable: jest.fn(), refresh: jest.fn(async () => null), consentSheet: null }),
}));
jest.mock('@/components/ad-slot', () => ({ AdSlot: () => null }));

const script: ScriptCard = {
  id: 's1',
  title: '옥상 장면',
  my_character_names: ['민지'],
  dialogue_count: 12,
  recording_count: 3,
  last_practiced_at: null,
  last_activity_at: '2026-10-01T00:00:00Z',
  status: 'reading',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const running = (percent: number): ScriptImport => ({
  id: 'i1',
  status: 'running',
  progress: { done_lines: 10, total_lines: 40, percent },
  script_id: null,
  failure: null,
});
const failed: ScriptImport = { ...running(0), status: 'failed', failure: 'not_script' };
const succeeded: ScriptImport = { ...running(100), status: 'succeeded', script_id: 's2' };

const scriptsOf = (...scripts: ScriptCard[]) => ({ scripts, total_count: scripts.length, in_progress_count: 0 });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(listScripts).mockResolvedValue(scriptsOf(script));
});

/** 구분선에는 testID 가 없어 그려진 트리에서 모양(높이 1, 아이콘 24 + 간격 12 만큼 들여쓰기)으로 찾는다. */
type Tree = { props: { style?: unknown }; children: readonly (Tree | string)[] };
function dividerCount(node: Tree = screen.root as never): number {
  const style = StyleSheet.flatten(node.props.style as never) as { height?: number; marginLeft?: number } | undefined;
  const self = style?.height === 1 && style.marginLeft === 36 ? 1 : 0;
  return node.children.reduce((sum, child) => sum + (typeof child === 'string' ? 0 : dividerCount(child)), self);
}

test('나누기 행과 대본 행을 합쳐 행 사이에만 구분선이 있다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(running(50));
  jest.mocked(listScripts).mockResolvedValue(scriptsOf(script, { ...script, id: 's2', title: '카페 장면' }));
  await render(<ReadingList />);

  await screen.findByText('버스정류장');
  await screen.findByText('카페 장면');
  expect(dividerCount()).toBe(2);
});

test('대본이 하나뿐이면 구분선이 없다', async () => {
  await render(<ReadingList />);

  await screen.findByText('옥상 장면');
  expect(dividerCount()).toBe(0);
});

test('입구 화면의 나누기 카드에는 구분선이 없다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(running(50));
  jest.mocked(listScripts).mockResolvedValue(scriptsOf());
  await render(<ReadingList />);

  await screen.findByText('버스정류장');
  expect(dividerCount()).toBe(0);
});

test('받기 전 뼈대도 줄 사이에 같은 구분선이 있다', async () => {
  rememberSkeletonHints({ reading: 'list', readingRows: 3 });
  jest.mocked(listScripts).mockReturnValue(new Promise(() => undefined));
  await render(<ReadingList />);

  expect(screen.getByText('업로드한 대본')).toBeOnTheScreen();
  expect(dividerCount()).toBe(2);
});

test('진행 행은 첫 대본 위에 %와 막대를 보이고 물을 때마다 오르며 누를 수 없다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValueOnce(running(62)).mockResolvedValue(running(70));
  await render(<ReadingList />);

  expect(await screen.findByText('버스정류장')).toBeOnTheScreen();
  expect(await screen.findByText(/배역과 대사 찾는 중 · 62%|62%/)).toBeOnTheScreen();
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: 62 });
  expect(screen.queryByText('지우기')).not.toBeOnTheScreen();
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 70 }), { timeout: 3000 });
  expect(screen.getByText('옥상 장면')).toBeOnTheScreen();
});

test('끝나면 대본 목록을 다시 받은 뒤 행과 기록을 지운다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValueOnce(running(90)).mockResolvedValue(succeeded);
  await render(<ReadingList />);
  await screen.findByText('버스정류장');
  jest.mocked(listScripts).mockResolvedValue(scriptsOf({ ...script, id: 's2', title: '버스정류장 대본' }, script));

  expect(await screen.findByText('버스정류장 대본', {}, { timeout: 3000 })).toBeOnTheScreen();
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen());
  expect(await readSplitJobs()).toEqual([]);
});

test('이미 끝난 작업(완료 푸시로 넘어간 경우)은 행을 비치지 않고 기록을 지운다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(succeeded);
  await render(<ReadingList />);

  await waitFor(async () => expect(await readSplitJobs()).toEqual([]));
  expect(screen.queryByText('버스정류장')).not.toBeOnTheScreen();
});

test('실패하면 실패 행을 보이고 다시 묻지 않으며 [지우기]는 기록만 지운다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(failed);
  await render(<ReadingList />);

  expect(await screen.findByText(/나누지 못했어요/)).toBeOnTheScreen();
  expect(screen.getByText(/다시 넣어 주세요/)).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));
  expect(api.getScriptImport).toHaveBeenCalledTimes(1);
  expect(await readSplitJobs()).toHaveLength(1);

  await fireEvent.press(screen.getByRole('button', { name: '지우기' }));
  expect(screen.queryByText('버스정류장')).not.toBeOnTheScreen();
  await waitFor(async () => expect(await readSplitJobs()).toEqual([]));
});

test('없는 작업(다른 계정의 작업 포함)은 제목을 비치지 않고 기록을 지운다', async () => {
  await addSplitJob({ importId: 'i1', title: '남의 대본' });
  jest.mocked(api.getScriptImport).mockRejectedValue(new ApiError(404, '없음', 'import_not_found'));
  await render(<ReadingList />);

  await waitFor(async () => expect(await readSplitJobs()).toEqual([]));
  expect(screen.queryByText('남의 대본')).not.toBeOnTheScreen();
});

test('끊김은 행을 그대로 두고 다시 묻는다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValueOnce(running(40)).mockRejectedValueOnce(new Error('끊김')).mockResolvedValue(running(50));
  await render(<ReadingList />);

  await screen.findByText('버스정류장');
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 50 }), { timeout: 4000 });
  expect(await readSplitJobs()).toHaveLength(1);
});

test('작업이 둘이면 1초에 한 번씩 번갈아 묻는다', async () => {
  await addSplitJob({ importId: 'i1', title: '첫째' });
  await addSplitJob({ importId: 'i2', title: '둘째' });
  jest.mocked(api.getScriptImport).mockResolvedValue(running(10));
  await render(<ReadingList />);

  await screen.findByText('둘째');
  expect(api.getScriptImport).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('첫째', {}, { timeout: 3000 })).toBeOnTheScreen();
  expect(jest.mocked(api.getScriptImport).mock.calls.map(([id]) => id).slice(0, 2)).toEqual(['i2', 'i1']);
});

test('화면에 온 뒤에 접수된 작업도 나타난다', async () => {
  jest.mocked(api.getScriptImport).mockResolvedValue(running(5));
  await render(<ReadingList />);
  await screen.findByText('옥상 장면');

  await act(async () => addSplitJob({ importId: 'i1', title: '늦은 접수' }));
  expect(await screen.findByText('늦은 접수', {}, { timeout: 3000 })).toBeOnTheScreen();
});

test('앱이 백그라운드면 묻지 않는다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  const foreground = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true, writable: true });
  await render(<ReadingList />);
  await screen.findByText('옥상 장면');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));

  expect(api.getScriptImport).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', { value: foreground, configurable: true, writable: true });
});

test('대본이 없으면 입구 카드 위에 같은 행을 보인다', async () => {
  jest.mocked(listScripts).mockResolvedValue(scriptsOf());
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(running(30));
  await render(<ReadingList />);

  expect(await screen.findByText('버스정류장')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '내 대본 올리기' })).toBeOnTheScreen();
});

test('검색 중에는 행을 숨긴다', async () => {
  await addSplitJob({ importId: 'i1', title: '버스정류장' });
  jest.mocked(api.getScriptImport).mockResolvedValue(running(30));
  await render(<ReadingList />);
  await screen.findByText('버스정류장');

  await fireEvent.changeText(screen.getByPlaceholderText('작품명 또는 배역 검색'), '옥상');
  expect(screen.queryByText('버스정류장')).not.toBeOnTheScreen();
});
