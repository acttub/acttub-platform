import { fireEvent, render, screen } from '@testing-library/react-native';

import ReadingCompare from '@/app/reading/compare';
import { fetchSession, getCurrent } from '@/lib/reading/store';

jest.mock('@/lib/reading/store', () => ({ fetchSession: jest.fn(), getCurrent: jest.fn() }));
jest.mock('@/lib/reading/recording-runner', () => ({ onRecordingQueueChange: () => () => undefined }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
const mockPlay = jest.fn();
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({ play: mockPlay, addListener: jest.fn(), remove: jest.fn(), pause: jest.fn(), release: jest.fn() })),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ prev: 'p', cur: 'c' }),
}));

const rec = (line_id: string, duration_ms: number, url: string | null = 'https://a') => ({
  id: line_id + duration_ms, line_id, attempt_no: 1, duration_ms, content_type: 'audio/m4a', byte_size: 1,
  transcript: null, transcript_source: 'none', playback_url: url, playback_expires_at: null,
});

beforeEach(() => {
  (getCurrent as jest.Mock).mockReturnValue({
    id: 's1',
    lineIds: ['l1', 'l2'],
    lines: [{ type: 'dialogue', role: '민지', text: '가지 마' }, { type: 'dialogue', role: '민지', text: '정말이야' }],
  });
});

test('두 번 모두 녹음한 대사만 보이고 길이 차이를 말한다', async () => {
  (fetchSession as jest.Mock).mockImplementation(async (id: string) =>
    id === 'p' ? { recordings: [rec('l1', 3200), rec('l2', 900)] } : { recordings: [rec('l1', 2600), rec('l2', 900, null)] },
  );
  await render(<ReadingCompare />);
  expect(await screen.findByText('두 번 모두 녹음한 대사 1개')).toBeOnTheScreen();
  expect(screen.getByText('가지 마')).toBeOnTheScreen();
  expect(screen.queryByText('정말이야')).not.toBeOnTheScreen();
  expect(screen.getByText('길이 3.2초 → 2.6초, 0.6초 짧아졌어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '차례로 듣기' }));
  expect(mockPlay).toHaveBeenCalled();
  expect(await screen.findByText('지난번')).toBeOnTheScreen();
});

test('겹치는 녹음이 없으면 빈 화면을 보인다', async () => {
  (fetchSession as jest.Mock).mockResolvedValue({ recordings: [] });
  await render(<ReadingCompare />);
  expect(await screen.findByText('두 번 모두 녹음이 남은 대사가 아직 없어요')).toBeOnTheScreen();
});

test('회차를 못 불러오면 오류와 다시 시도를 보인다', async () => {
  (fetchSession as jest.Mock).mockResolvedValue(null);
  await render(<ReadingCompare />);
  expect(await screen.findByText('녹음을 불러오지 못했어요')).toBeOnTheScreen();
});
