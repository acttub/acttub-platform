import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReadingCoachScreen from '@/app/reading/coach';
import { ReadingAfterCard } from '@/components/reading-after-card';
import { api } from '@/lib/api';

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/api', () => ({
  api: {
    probeRecordingCoach: jest.fn(),
    getPronunciationReport: jest.fn(),
    startRecordingCoach: jest.fn(),
    replyRecordingCoach: jest.fn(),
  },
}));

const probe = api.probeRecordingCoach as jest.Mock;
const report = api.getPronunciationReport as jest.Mock;
const startCoach = api.startRecordingCoach as jest.Mock;
const reply = api.replyRecordingCoach as jest.Mock;

const coach = (over: object = {}) => ({
  id: 'c1',
  reading_session_id: 's1',
  status: 'asked',
  messages: [{ role: 'coach', text: '「가자」 끝이 올라갔어요. 그때 서연은 뭘 원했어요?' }],
  video_line: null,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

test('서버 스위치가 켜져 있으면 코치 카드(위)와 발음 보고서 줄(아래)을 보이고 각 화면으로 간다(SOMA-791·606)', async () => {
  probe.mockRejectedValue(Object.assign(new Error('x'), { code: 'recording_coach_not_found' }));
  report.mockResolvedValue({ status: 'queued', report: null });
  await render(<ReadingAfterCard sessionId="s1" ready />);

  await fireEvent.press(await screen.findByRole('button', { name: '얘기해 보기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/reading/coach', params: { sessionId: 's1' } });
  await fireEvent.press(await screen.findByText('발음 보고서 보기'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/reading/pronunciation', params: { sessionId: 's1' } });
});

test('스위치가 꺼져 있거나 허용 밖이면 아무것도 그리지 않고, 녹음이 올라가는 중이면 묻지 않는다', async () => {
  probe.mockRejectedValue(Object.assign(new Error('x'), { code: 'Not Found' }));
  report.mockRejectedValue(Object.assign(new Error('x'), { code: 'pronunciation_not_available' }));
  const view = await render(<ReadingAfterCard sessionId="s1" ready />);
  await waitFor(() => expect(report).toHaveBeenCalled());
  expect(screen.queryByText('얘기해 보기')).not.toBeOnTheScreen();
  expect(screen.queryByText('발음 보고서 보기')).not.toBeOnTheScreen();
  await view.unmount();

  jest.clearAllMocks();
  await render(<ReadingAfterCard sessionId="s1" ready={false} />);
  expect(probe).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

test('녹음 코치: 첫 차례를 보이고 답하면 둘째 차례와 「이 한 줄 찍기」로 영상 촬영에 잇는다', async () => {
  mockParams = { sessionId: 's1' };
  startCoach.mockResolvedValue(coach());
  reply.mockResolvedValue(
    coach({
      status: 'answered',
      messages: [...coach().messages, { role: 'actor', text: '붙잡고 싶었어요' }, { role: 'coach', text: '소리로는 여기까지예요. 이 한 줄 찍어 봐요.' }],
      video_line: { line_id: 'l3', text: '가자' },
    }),
  );
  await render(<ReadingCoachScreen />);

  expect(await screen.findByText('「가자」 끝이 올라갔어요. 그때 서연은 뭘 원했어요?')).toBeOnTheScreen();
  expect(startCoach).toHaveBeenCalledWith('s1');
  await fireEvent.changeText(screen.getByLabelText('생각나는 대로 답해 주세요'), '붙잡고 싶었어요');
  await fireEvent.press(screen.getByRole('button', { name: '보내기' }));
  expect(reply).toHaveBeenCalledWith('c1', '붙잡고 싶었어요');
  expect(await screen.findByText('「가자」')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이 한 줄 찍기' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/record-guide', params: { next: 'upload' } });
});

test('녹음 코치: 소리가 든 녹음이 셋보다 적으면 이유를 알리고 닫기만 둔다', async () => {
  mockParams = { sessionId: 's1' };
  startCoach.mockRejectedValue(Object.assign(new Error('x'), { code: 'recording_coach_not_enough_audio' }));
  await render(<ReadingCoachScreen />);
  expect(await screen.findByText(/3줄 이상 있어야/)).toBeOnTheScreen();
  expect(screen.queryByLabelText('생각나는 대로 답해 주세요')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('녹음 코치: 코치가 답하지 못하면 알리고 「다시 시도」로 다시 시작한다', async () => {
  mockParams = { sessionId: 's1' };
  startCoach.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'recording_coach_unavailable' })).mockResolvedValue(coach());
  await render(<ReadingCoachScreen />);
  expect(await screen.findByText('코치가 지금 답하지 못했어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('「가자」 끝이 올라갔어요. 그때 서연은 뭘 원했어요?')).toBeOnTheScreen();
  expect(startCoach).toHaveBeenCalledTimes(2);
});

test('녹음 코치: 둘째 차례에 찍을 줄이 없으면 닫기만 둔다', async () => {
  mockParams = { sessionId: 's1' };
  startCoach.mockResolvedValue(coach({ status: 'answered', video_line: null }));
  await render(<ReadingCoachScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '닫기' }));
  expect(mockRouter.back).toHaveBeenCalled();
});
