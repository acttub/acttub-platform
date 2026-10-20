import { act, fireEvent, render, screen } from '@testing-library/react-native';

import LineNewScreen from '@/app/line-new';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

const mockRouter = { back: jest.fn(), replace: jest.fn() };
let mockParams: { line?: string } = {};
let mockIds = 0;
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/api', () => ({ api: { createChallenge: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/request-id', () => ({
  ...jest.requireActual('@/lib/request-id'),
  newRequestId: () => `req-${++mockIds}`,
}));

const createChallenge = api.createChallenge as jest.Mock;
const httpError = (status: number, code?: string) => Object.assign(new Error(`http ${status}`), { status, code });
const cta = (name: '다음' | '등록하기') => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockIds = 0;
});

async function fillToLastStep() {
  await fireEvent.changeText(screen.getByPlaceholderText('“여기에 대사를 적어주세요”'), '  나는   아직\n끝나지 않았어 ');
  await fireEvent.press(cta('다음'));
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상, 밤'), ' 옥상, 밤 ');
  await fireEvent.changeText(screen.getByPlaceholderText('예: 윤서'), ' 윤서 ');
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상에서 돌아서는 상대를 붙잡는 장면'), ' 붙잡는 장면 ');
  await fireEvent.press(cta('다음'));
}

test('세 단계를 채워 등록하면 열었다고 알리고 그 챌린지로 간다', async () => {
  createChallenge.mockResolvedValue({ id: 'c9' });
  await render(<LineNewScreen />);

  expect(screen.getByText('1 / 3')).toBeOnTheScreen();
  expect(cta('다음')).toBeDisabled();
  await fillToLastStep();

  expect(screen.getByText('3 / 3')).toBeOnTheScreen();
  expect(screen.getByText('“나는   아직\n끝나지 않았어”')).toBeOnTheScreen();
  expect(screen.getByText('옥상, 밤 · 윤서')).toBeOnTheScreen();
  expect(screen.getByText('붙잡는 장면')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '14일' }));
  expect(screen.getByRole('button', { name: '14일' })).toBeSelected();
  await fireEvent.press(cta('등록하기'));

  expect(createChallenge).toHaveBeenCalledWith({
    request_id: 'req-1',
    line: '나는 아직 끝나지 않았어',
    work: '옥상, 밤',
    character: '윤서',
    scene_note: '붙잡는 장면',
    duration_days: 14,
  });
  expect(logEvent).toHaveBeenCalledWith('challenge_created', { duration: 14 });
  expect(await screen.findByText('챌린지를 열었어요')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('확인'));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/challenge-detail', params: { id: 'c9' } });
});

test('검색에서 넘겨받은 대사로 시작하고 글자 수를 센다', async () => {
  mockParams = { line: '사느냐 죽느냐' };
  await render(<LineNewScreen />);

  expect(screen.getByDisplayValue('사느냐 죽느냐')).toBeOnTheScreen();
  expect(screen.getByText('7 / 200')).toBeOnTheScreen();
  expect(cta('다음')).toBeEnabled();
});

test('작품을 비우면 둘째 단계에서 넘어가지 않는다', async () => {
  mockParams = { line: '사느냐 죽느냐' };
  await render(<LineNewScreen />);
  await fireEvent.press(cta('다음'));

  expect(screen.getByText('2 / 3')).toBeOnTheScreen();
  expect(cta('다음')).toBeDisabled();
});

test('대사가 200자를 넘으면 다시 확인하라고 하고 막는다', async () => {
  await render(<LineNewScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('“여기에 대사를 적어주세요”'), '가'.repeat(201));

  expect(screen.getByText('적은 내용을 다시 확인해 주세요.')).toBeOnTheScreen();
  expect(cta('다음')).toBeDisabled();
});

test('뒤로는 앞 단계로 가고 첫 단계에서는 화면을 닫는다', async () => {
  mockParams = { line: '사느냐 죽느냐' };
  await render(<LineNewScreen />);
  await fireEvent.press(cta('다음'));

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.getByText('1 / 3')).toBeOnTheScreen();
  expect(mockRouter.back).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('같은 내용으로 다시 보내면 같은 요청 id를, 지문이 어긋났다는 답 뒤에는 새 id를 쓴다', async () => {
  createChallenge
    .mockRejectedValueOnce(httpError(409, 'duplicate_challenge'))
    .mockRejectedValueOnce(httpError(409, 'request_fingerprint_mismatch'))
    .mockRejectedValueOnce(httpError(429));
  await render(<LineNewScreen />);
  await fillToLastStep();

  await fireEvent.press(cta('등록하기'));
  expect(await screen.findByText('같은 대사로 진행 중인 챌린지가 이미 있어요.')).toBeOnTheScreen();
  await fireEvent.press(cta('등록하기'));
  expect(await screen.findByText('적은 내용을 다시 확인해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(cta('등록하기'));
  expect(await screen.findByText('하루에 세 개까지 열 수 있어요. 내일 다시 열어 주세요.')).toBeOnTheScreen();

  expect(createChallenge.mock.calls.map(([body]) => body.request_id)).toEqual(['req-1', 'req-1', 'req-2']);
});

test('보내는 동안 버튼을 막는다', async () => {
  let resolve!: (v: unknown) => void;
  createChallenge.mockReturnValue(new Promise((r) => (resolve = r)));
  await render(<LineNewScreen />);
  await fillToLastStep();

  await fireEvent.press(cta('등록하기'));
  expect(screen.queryByText('등록하기')).not.toBeOnTheScreen();
  await act(async () => resolve({ id: 'c9' }));
  expect(await screen.findByText('챌린지를 열었어요')).toBeOnTheScreen();
  expect(createChallenge).toHaveBeenCalledTimes(1);
});

test('인물·메모를 비우면 본문에 넣지 않는다', async () => {
  createChallenge.mockRejectedValue(httpError(403));
  mockParams = { line: '대사' };
  await render(<LineNewScreen />);
  await fireEvent.press(cta('다음'));
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상, 밤'), '작품');
  await fireEvent.press(cta('다음'));

  expect(screen.getByText('작품')).toBeOnTheScreen();
  await fireEvent.press(cta('등록하기'));

  expect(createChallenge).toHaveBeenCalledWith({ request_id: 'req-1', line: '대사', work: '작품', duration_days: 7 });
  expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
});
