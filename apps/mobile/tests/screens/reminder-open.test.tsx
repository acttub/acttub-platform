import { render, waitFor } from '@testing-library/react-native';

import ReminderOpenScreen from '@/app/reminder-open';
import { api } from '@/lib/api';
import { localCopyFor } from '@/lib/library/library-runner';
import { peekPickedVideo, clearPickedVideo } from '@/lib/practice/picked-video';
import { takeContinueOrigin } from '@/lib/practice/session-state';
import { loadIntoCurrent } from '@/lib/reading/store';

jest.mock('@/lib/api', () => ({ api: { getVideo: jest.fn(), getPractice: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/library/library-runner', () => ({ localCopyFor: jest.fn() }));
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn() }));
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

const id = '12345678-1234-1234-1234-123456789abc';

beforeEach(() => {
  mockReplace.mockReset();
  clearPickedVideo();
  takeContinueOrigin();
});

test('안 읽은 대본 알림은 그 대본의 리딩 준비 화면을 연다', async () => {
  mockParams = { kind: 'unread_script', id };
  (loadIntoCurrent as jest.Mock).mockResolvedValue({ id });
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reading/detail'));
  expect(loadIntoCurrent).toHaveBeenCalledWith(id);
});

test('지워진 대본이면 홈으로 간다', async () => {
  mockParams = { kind: 'unread_script', id };
  (loadIntoCurrent as jest.Mock).mockResolvedValue(null);
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
});

test('안 쓴 영상 알림은 그 영상을 얹은 새 연습 준비 화면을 연다', async () => {
  mockParams = { kind: 'pending_video', id };
  (api.getVideo as jest.Mock).mockResolvedValue({ id, purged_at: null, playback_url: 'https://v', duration_ms: 9000 });
  (localCopyFor as jest.Mock).mockResolvedValue('file://v.mp4');
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/upload'));
  expect(peekPickedVideo()).toEqual({ videoId: id, pendingId: null, uri: 'file://v.mp4', playbackUrl: 'https://v', durationMs: 9000 });
  expect(takeContinueOrigin()).toBeNull();
});

test('파일을 파기했거나 못 찾는 영상이면 홈으로 간다', async () => {
  mockParams = { kind: 'pending_video', id };
  (api.getVideo as jest.Mock).mockResolvedValue({ id, purged_at: '2026-10-27T00:00:00Z', playback_url: null, duration_ms: 0 });
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  mockReplace.mockReset();
  (api.getVideo as jest.Mock).mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  expect(peekPickedVideo()).toBeNull();
});

test('숙제 알림은 그 묶음의 다음 테이크 준비 화면을 연다', async () => {
  mockParams = { kind: 'homework', id };
  (api.getPractice as jest.Mock).mockResolvedValue({ id, root_id: 'root-1' });
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/upload'));
  expect(takeContinueOrigin()).toEqual({ kind: 'group', rootId: 'root-1', practiceId: id });
});

test('모르는 종류나 빈 id는 바로 홈으로 간다', async () => {
  mockParams = { kind: 'other', id };
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  mockReplace.mockReset();
  mockParams = { kind: 'homework' };
  await render(<ReminderOpenScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
});
