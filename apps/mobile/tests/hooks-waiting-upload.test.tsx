import { act, renderHook, waitFor } from '@testing-library/react-native';

import { forgetWaitingUpload, rememberWaitingUpload, useWaitingUpload } from '@/hooks/use-waiting-upload';
import { api } from '@/lib/api';
import * as runner from '@/lib/library/library-runner';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/api', () => ({
  api: { createPractice: jest.fn(), continuePractice: jest.fn(), listPracticeGroups: jest.fn() },
}));
jest.mock('@/lib/library/library-runner', () => ({
  confirmedVideoFor: jest.fn(() => null),
  flushLibraryUploads: jest.fn(async () => undefined),
  onLibraryChange: jest.fn(() => () => undefined),
  pendingLibraryUploads: jest.fn(async () => []),
  removePendingUpload: jest.fn(async () => undefined),
}));

const waiting = {
  owner: 'u1',
  pendingId: 'p1',
  videoId: null as string | null,
  requestId: 'r1',
  continueFrom: null as { rootId: string; practiceId: string } | null,
  scene: { situation: '', character: '', goal: '' },
  blockage: { category: null, detail: null, note: '' },
  savedAt: 1,
};
const r = runner as jest.Mocked<typeof runner>;
const a = api as unknown as Record<string, jest.Mock>;

beforeEach(async () => {
  jest.clearAllMocks();
  r.pendingLibraryUploads.mockResolvedValue([]);
  r.confirmedVideoFor.mockReturnValue(null);
  await forgetWaitingUpload('u1');
});

const entry = (status: 'queued' | 'uploading' | 'failed') => [{ id: 'p1', status }] as never;

test('기록이 없으면 카드가 없다', async () => {
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(r.pendingLibraryUploads).not.toHaveBeenCalled());
  expect(result.current.card).toBeNull();
});

test('올리는 중 → 실패 → 다시 올리기', async () => {
  r.pendingLibraryUploads.mockResolvedValue(entry('uploading'));
  await rememberWaitingUpload(waiting);
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('uploading'));
  r.pendingLibraryUploads.mockResolvedValue(entry('failed'));
  await act(async () => result.current.retry());
  expect(r.flushLibraryUploads).toHaveBeenCalledWith('u1');
  expect(result.current.card?.state).toBe('failed');
});

test('큐에서 사라지고 영상도 없으면 기록을 지운다', async () => {
  await rememberWaitingUpload(waiting);
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(r.pendingLibraryUploads).toHaveBeenCalled());
  await waitFor(() => expect(result.current.card).toBeNull());
});

test('다 올라가면 영상 id 를 기록하고 질문 받기로 새 연습을 시작한다', async () => {
  r.confirmedVideoFor.mockReturnValue('v1');
  a.createPractice.mockResolvedValue({ id: 'pr1' });
  await rememberWaitingUpload(waiting);
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('ready'));
  expect(result.current.card?.waiting.videoId).toBe('v1');
  await act(async () => result.current.begin());
  expect(a.createPractice).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'r1', video_id: 'v1' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'pr1' } });
  await waitFor(() => expect(result.current.card).toBeNull());
});

test('이어하기는 continuePractice 로 시작한다', async () => {
  a.continuePractice.mockResolvedValue({ id: 'pr2' });
  await rememberWaitingUpload({ ...waiting, videoId: 'v9', continueFrom: { rootId: 'g1', practiceId: 'pr0' } });
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('ready'));
  await act(async () => result.current.begin());
  expect(a.continuePractice).toHaveBeenCalledWith('pr0', expect.objectContaining({ video_id: 'v9' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'pr2' } });
});

test('시작 실패는 오류 문구로 남고 카드는 유지된다', async () => {
  a.createPractice.mockRejectedValue({ status: 429, code: 'guest_daily_analysis_limit' });
  await rememberWaitingUpload({ ...waiting, videoId: 'v1' });
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('ready'));
  await act(async () => result.current.begin());
  expect(result.current.error).toBeTruthy();
  expect(result.current.card?.state).toBe('ready');
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('진행 중 회차가 있으면(409) 그 회차로 보낸다', async () => {
  a.createPractice.mockRejectedValue({ status: 409, code: 'practice_in_progress' });
  a.listPracticeGroups.mockResolvedValue({ groups: [] });
  await rememberWaitingUpload({ ...waiting, videoId: 'v1' });
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('ready'));
  await act(async () => result.current.begin());
  expect(a.listPracticeGroups).toHaveBeenCalled();
  expect(result.current.error).toBeTruthy();
});

test('취소하면 큐 항목과 기록을 지운다', async () => {
  r.pendingLibraryUploads.mockResolvedValue(entry('uploading'));
  await rememberWaitingUpload(waiting);
  const { result } = await renderHook(() => useWaitingUpload());
  await waitFor(() => expect(result.current.card?.state).toBe('uploading'));
  await act(async () => result.current.cancel());
  expect(r.removePendingUpload).toHaveBeenCalledWith('p1');
  await waitFor(() => expect(result.current.card).toBeNull());
});
