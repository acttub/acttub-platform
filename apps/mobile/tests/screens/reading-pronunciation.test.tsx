import { act, fireEvent, render, screen } from '@testing-library/react-native';

import PronunciationReportScreen from '@/app/reading/pronunciation';
import { api } from '@/lib/api';

let mockParams: Record<string, string> = { sessionId: 's1' };
const mockPlayer = { addListener: jest.fn(), play: jest.fn(), seekTo: jest.fn(async () => undefined), remove: jest.fn(), pause: jest.fn() };

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockPlayer) }));
jest.mock('@/lib/audio-dispose', () => ({ disposeAudioPlayer: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getPronunciationReport: jest.fn() } }));
jest.mock('@/lib/reading/store', () => ({
  getCurrent: () => ({ lines: [{ type: 'direction', text: '옥상, 밤' }, { type: 'dialogue', text: '그럼, 내가 힘들면 어떡해?' }], lineIds: ['l1', 'l2'] }),
  fetchSession: jest.fn(async () => ({
    recordings: [
      {
        id: 'r1',
        line_id: 'l2',
        attempt_no: 1,
        duration_ms: 2000,
        content_type: 'audio/m4a',
        byte_size: 1,
        transcript: '그럼 내가 힘들면 어떡해',
        transcript_source: 'stt',
        playback_url: 'https://x/r1.m4a',
        playback_expires_at: '2999-01-01T00:00:00Z',
      },
    ],
  })),
}));

const getReport = api.getPronunciationReport as jest.Mock;

const done = {
  status: 'done',
  report: {
    summary: { sounds: 20, clearSounds: 18, clearRatio: 0.9, linesUsed: 1, linesSkipped: 0 },
    misheard: [{ lineNo: 2, word: '어떡해', heard: '어떻게' }],
    habit: { habit: 'CODA', label: '받침 소리가 흐려요', count: 2, examples: [] },
    skippedLines: [],
    lines: [{ lineNo: 2, text: '그럼, 내가 힘들면 어떡해?', marks: [{ index: 2, word: '힘들면', lpr: -5, startMs: 400, endMs: 800 }] }],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockParams = { sessionId: 's1' };
});

test('채점이 끝나면 다르게 들린 어절을 칠한 줄·습관·다른 말을 보이고, 그 어절만 이번 녹음에서 튼다(SOMA-606)', async () => {
  getReport.mockResolvedValue(done);
  await render(<PronunciationReportScreen />);

  expect(await screen.findByText('1줄에서 다르게 들린 말이 있어요')).toBeOnTheScreen();
  expect(screen.getByText('받침 소리가 흐려요')).toBeOnTheScreen();
  expect(screen.getByText('힘들면')).toBeOnTheScreen();
  expect(screen.getByText('어떡해 → 어떻게')).toBeOnTheScreen();

  await fireEvent.press(await screen.findByText("'힘들면' 듣기"));
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(0.25);
  expect(mockPlayer.play).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('줄 전체'));
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
});

test('채점 중이면 기다림을 보이고 다시 물어 끝나면 보고서로 바꾼다', async () => {
  jest.useFakeTimers();
  getReport.mockResolvedValueOnce({ status: 'running', report: null }).mockResolvedValue(done);
  await render(<PronunciationReportScreen />);
  expect(await screen.findByText(/보고서를 만들고 있어요/)).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(4_000);
  });
  expect(await screen.findByText('1줄에서 다르게 들린 말이 있어요')).toBeOnTheScreen();
  expect(getReport).toHaveBeenCalledTimes(2);
});

test('쓸 줄이 없거나 실패·허용 밖이면 그 이유만 보인다', async () => {
  getReport.mockResolvedValue({ status: 'skipped', report: null });
  const view = await render(<PronunciationReportScreen />);
  expect(await screen.findByText('대본대로 읽은 줄이 없어서 보고서를 만들지 않았어요.')).toBeOnTheScreen();
  await view.unmount();

  getReport.mockRejectedValue(Object.assign(new Error('x'), { code: 'pronunciation_not_available' }));
  await render(<PronunciationReportScreen />);
  // 허용 밖(아직 이 사람에게 열지 않음)은 실패가 아니라 준비 중이라고 알린다(10/29).
  expect(await screen.findByText(/발음 보고서는 준비 중이에요/)).toBeOnTheScreen();
  expect(screen.queryByText(/보고서를 만들지 못했어요/)).not.toBeOnTheScreen();
});

test('칠할 어절이 없으면 다르게 들린 말이 없다고 한다', async () => {
  getReport.mockResolvedValue({ ...done, report: { ...done.report, misheard: [], habit: null, lines: [{ ...done.report.lines[0], marks: [] }] } });
  await render(<PronunciationReportScreen />);
  expect(await screen.findByText('다르게 들린 말이 없었어요')).toBeOnTheScreen();
});
