import { act, fireEvent, render, screen } from '@testing-library/react-native';

import AiReportScreen from '@/app/ai-report';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { AiReport } from '@/lib/challenge/types';
import { newRequestId } from '@/lib/request-id';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockParams: { entryId?: string; request?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/api', () => ({ api: { getAiReport: jest.fn(), requestAiReport: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/request-id', () => ({ newRequestId: jest.fn() }));
jest.mock('@/lib/library/library-runner', () => ({ localCopyFor: jest.fn(async () => null) }));
jest.mock('@/lib/challenge/intro-state', () => ({ hasFinishedFirstChallenge: jest.fn(async () => true) }));

const getAiReport = api.getAiReport as jest.Mock;
const requestAiReport = api.requestAiReport as jest.Mock;
const nextId = newRequestId as jest.Mock;

const status = (code: number) => Object.assign(new Error(`http ${code}`), { status: code });

function report(overrides: Partial<AiReport> = {}): AiReport {
  return {
    entry_id: 'e1',
    status: 'ready',
    observations: [{ start_ms: 3000, end_ms: 65000, text: '첫 줄에서 시선을 내렸다' }],
    comparisons: ['다른 참여작들은 대사 전에 쉬었다'],
    limits: ['뒷모습 구간은 보지 못했다'],
    suggestion: '  대사 전에 한 번 숨을 고르기  ',
    sample_count: 5,
    attempt_count: 1,
    requested_at: null,
    completed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { entryId: 'e1' };
  let n = 0;
  nextId.mockImplementation(() => `req-${++n}`);
});

test('준비된 리포트를 관찰·견주기·한계·다음 시도 순으로 보여 준다', async () => {
  getAiReport.mockResolvedValue(report());
  await render(<AiReportScreen />);

  expect(await screen.findByText('첫 줄에서 시선을 내렸다')).toBeOnTheScreen();
  expect(getAiReport).toHaveBeenCalledWith('e1');
  expect(screen.getByText('0:03–1:05')).toBeOnTheScreen();
  expect(screen.getByText('다른 참여작들은 대사 전에 쉬었다')).toBeOnTheScreen();
  expect(screen.getByText('뒷모습 구간은 보지 못했다')).toBeOnTheScreen();
  expect(screen.getByText('대사 전에 한 번 숨을 고르기')).toBeOnTheScreen();
  expect(screen.getAllByText(/영상에서 확인된 것|다른 참여작들과 견주면|못 본 것|다음에 해볼 한 가지/).map((n) => n.props.children)).toEqual([
    '영상에서 확인된 것',
    '다른 참여작들과 견주면',
    '못 본 것',
    '다음에 해볼 한 가지',
  ]);
  expect(screen.queryByText('비교할 영상이 아직 부족해요. 이번에는 관찰만 담았어요.')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'AI 리포트 받기' })).not.toBeOnTheScreen();
});

test('표본이 모자라면 견주기 대신 부족하다고 말하고, 제안이 없으면 없다고 말한다', async () => {
  getAiReport.mockResolvedValue(report({ sample_count: 2, comparisons: [], suggestion: null }));
  await render(<AiReportScreen />);

  expect(await screen.findByText('비교할 영상이 아직 부족해요. 이번에는 관찰만 담았어요.')).toBeOnTheScreen();
  expect(screen.getByText('이번에는 다음에 해볼 것을 정하지 않았어요.')).toBeOnTheScreen();
});

test('아직 만든 적이 없으면 요청 버튼을 두고, 누르면 리포트를 요청해 다시 읽는다', async () => {
  getAiReport.mockRejectedValueOnce(status(404)).mockResolvedValueOnce(report({ status: 'pending' }));
  requestAiReport.mockResolvedValue(undefined);
  await render(<AiReportScreen />);

  expect(await screen.findByText('아직 리포트가 없어요.')).toBeOnTheScreen();
  expect(screen.getByText('리포트는 하루에 세 번까지 만들 수 있어요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'AI 리포트 받기' }));

  expect(requestAiReport).toHaveBeenCalledWith('e1', 'req-1');
  expect(logEvent).toHaveBeenCalledWith('challenge_report_requested', {});
  expect(await screen.findByText('리포트를 만들고 있어요. 다 되면 알림으로 알려드려요.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'AI 리포트 받기' })).not.toBeOnTheScreen();
});

test('만드는 중이면 5초마다 다시 읽어 준비되면 보여 준다', async () => {
  jest.useFakeTimers();
  try {
    getAiReport.mockResolvedValueOnce(report({ status: 'pending' })).mockResolvedValueOnce(report());
    await render(<AiReportScreen />);
    expect(await screen.findByText('리포트를 만들고 있어요. 다 되면 알림으로 알려드려요.')).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTime(5000));

    expect(await screen.findByText('첫 줄에서 시선을 내렸다')).toBeOnTheScreen();
    expect(getAiReport).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('실패한 리포트는 다시 시도가 한도를 쓴다고 알리고 다시 요청한다', async () => {
  getAiReport.mockResolvedValue(report({ status: 'failed' }));
  requestAiReport.mockRejectedValue(status(429));
  await render(<AiReportScreen />);

  expect(await screen.findByText('리포트를 만들지 못했어요.')).toBeOnTheScreen();
  expect(screen.getByText('다시 시도하면 새로 만들어요. 하루 세 번 중 한 번을 써요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  expect(await screen.findByText('오늘 리포트를 다 만들었어요. 내일 다시 받아 주세요.')).toBeOnTheScreen();
  expect(requestAiReport).toHaveBeenCalledWith('e1', 'req-1');
});

test('연결이 끊겨 실패하면 같은 요청 id로 다시 보내고, 다른 실패 뒤에는 새 id를 쓴다', async () => {
  getAiReport.mockRejectedValue(status(404));
  requestAiReport
    .mockRejectedValueOnce(new Error('network down'))
    .mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 400, code: 'video_not_ready' }))
    .mockRejectedValueOnce(status(400));
  await render(<AiReportScreen />);
  const pressRequest = async () => {
    await fireEvent.press(await screen.findByRole('button', { name: 'AI 리포트 받기' }));
  };
  const closeAlert = async () => {
    await fireEvent.press(screen.getByText('확인'));
  };

  await pressRequest();
  expect(await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await closeAlert();
  await pressRequest();
  expect(await screen.findByText('영상 파일이 없어 리포트를 만들 수 없어요.')).toBeOnTheScreen();
  await closeAlert();
  await pressRequest();
  expect(await screen.findByText('리포트를 요청하지 못했어요.')).toBeOnTheScreen();

  expect(requestAiReport.mock.calls).toEqual([
    ['e1', 'req-1'],
    ['e1', 'req-1'],
    ['e1', 'req-2'],
  ]);
});

test('리포트를 읽지 못하면 이유를 보여 준다', async () => {
  getAiReport.mockRejectedValue(status(429));
  await render(<AiReportScreen />);

  expect(await screen.findByText('오늘 리포트를 다 만들었어요. 내일 다시 받아 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('아직 리포트가 없어요.')).not.toBeOnTheScreen();
});

test('참여작 id 없이 열면 읽지도 요청하지도 않는다', async () => {
  mockParams = {};
  await render(<AiReportScreen />);

  await fireEvent.press(screen.getByRole('button', { name: 'AI 리포트 받기' }));
  expect(getAiReport).not.toHaveBeenCalled();
  expect(requestAiReport).not.toHaveBeenCalled();
  expect(screen.getByText('점수나 순위를 매기지 않아요. 무엇이 어떻게 달랐는지만 봐요.')).toBeOnTheScreen();
});

test('뒤로를 누르면 이전 화면으로 간다', async () => {
  getAiReport.mockResolvedValue(report());
  await render(<AiReportScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: /뒤로/ }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('요청을 보내는 동안 버튼을 막는다', async () => {
  let finish!: () => void;
  getAiReport.mockRejectedValueOnce(status(404)).mockResolvedValueOnce(report({ status: 'pending' }));
  requestAiReport.mockReturnValue(new Promise<void>((r) => (finish = r)));
  await render(<AiReportScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: 'AI 리포트 받기' }));
  const [requestButton] = screen.getAllByRole('button');
  expect(requestButton).toBeDisabled();
  expect(screen.queryByText('AI 리포트 받기')).not.toBeOnTheScreen();

  await act(async () => finish());
  expect(requestAiReport).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('리포트를 만들고 있어요. 다 되면 알림으로 알려드려요.')).toBeOnTheScreen();
});

describe('올리기 완료의 「AI 리포트 보기」로 왔을 때(request=1)', () => {
  test('아직 없는 리포트는 누르지 않아도 한 번 바로 요청한다', async () => {
    mockParams = { entryId: 'e1', request: '1' };
    getAiReport.mockRejectedValueOnce(status(404)).mockResolvedValueOnce(report({ status: 'pending' }));
    requestAiReport.mockResolvedValue(undefined);
    await render(<AiReportScreen />);

    expect(await screen.findByText('리포트를 만들고 있어요. 다 되면 알림으로 알려드려요.')).toBeOnTheScreen();
    expect(requestAiReport).toHaveBeenCalledTimes(1);
    expect(requestAiReport).toHaveBeenCalledWith('e1', 'req-1');
    expect(logEvent).toHaveBeenCalledWith('challenge_report_requested', {});
  });

  test('이미 있거나 실패한 리포트는 다시 요청하지 않는다(다시 시도는 한도를 쓴다)', async () => {
    mockParams = { entryId: 'e1', request: '1' };
    getAiReport.mockResolvedValue(report({ status: 'failed' }));
    await render(<AiReportScreen />);

    expect(await screen.findByText('리포트를 만들지 못했어요.')).toBeOnTheScreen();
    expect(requestAiReport).not.toHaveBeenCalled();
  });
});
