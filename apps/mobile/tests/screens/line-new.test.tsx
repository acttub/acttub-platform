import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockIds = 0;
});

const PH = '“여기에 대사를 적어주세요”';
const fill = (text = '  나는   아직\n끝나지 않았어 ') => fireEvent.changeText(screen.getByPlaceholderText(PH), text);
const cta = () => screen.getByRole('button', { name: '등록하기' });
const next = () => screen.getByRole('button', { name: '다음' });
/** 1단계 대사 → 2단계 작품 → 3단계 기간까지 넘긴다. */
const toLastStep = async (work = '옥상, 밤') => {
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상, 밤'), work);
  await fireEvent.press(next());
};

test('세 단계(대사 → 작품·인물·메모 → 기간)로 등록하고 그 챌린지로 간다', async () => {
  createChallenge.mockResolvedValue({ id: 'c9' });
  await render(<LineNewScreen />);

  expect(next()).toBeDisabled();
  expect(screen.getByText('1 / 3')).toBeOnTheScreen();
  expect(screen.getByText('어떤 대사를\n등록할까요?')).toBeOnTheScreen();
  await fill();
  await fireEvent.press(next());

  expect(screen.getByText('2 / 3')).toBeOnTheScreen();
  expect(next()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상, 밤'), ' 옥상, 밤 ');
  await fireEvent.changeText(screen.getByPlaceholderText('예: 윤서'), '윤서');
  await fireEvent.changeText(screen.getByPlaceholderText('예: 옥상에서 돌아서는 상대를 붙잡는 장면'), '붙잡는 장면');
  await fireEvent.press(next());

  expect(screen.getByText('3 / 3')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: '14일' }));
  expect(screen.getByRole('radio', { name: '14일' })).toBeSelected();
  await fireEvent.press(cta());

  expect(createChallenge).toHaveBeenCalledWith({
    request_id: 'req-1',
    line: '나는 아직 끝나지 않았어',
    work: '옥상, 밤',
    character: '윤서',
    scene_note: '붙잡는 장면',
    duration_days: 14,
  });
  expect(logEvent).toHaveBeenCalledWith('challenge_created', { duration: 14 });
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/challenge-detail', params: { id: 'c9', opened: '1' } }));
});

test('검색에서 넘겨받은 대사로 시작하고 글자 수를 센다', async () => {
  mockParams = { line: '잘 지내' };
  await render(<LineNewScreen />);
  expect(screen.getByDisplayValue('잘 지내')).toBeOnTheScreen();
  expect(screen.getByText('4 / 200')).toBeOnTheScreen();
  expect(next()).toBeEnabled();
});

test('대사가 200자를 넘으면 다시 확인하라고 하고 막는다', async () => {
  await render(<LineNewScreen />);
  await fill('가'.repeat(201));
  expect(screen.getByText('200자까지 적을 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('201 / 200')).toBeOnTheScreen();
  expect(next()).toBeDisabled();
});

test('1단계 닫기는 화면을 닫고, 2단계 뒤로는 이전 단계로 돌아간다', async () => {
  await render(<LineNewScreen />);
  await fill('잘 지내');
  await fireEvent.press(next());
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.getByText('1 / 3')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('같은 내용으로 다시 보내면 같은 요청 id를, 지문이 어긋났다는 답 뒤에는 새 id를 쓴다', async () => {
  createChallenge
    .mockRejectedValueOnce(httpError(409, 'duplicate_challenge'))
    .mockRejectedValueOnce(httpError(409, 'request_fingerprint_mismatch'))
    .mockRejectedValueOnce(httpError(429));
  await render(<LineNewScreen />);
  await fill('잘 지내');
  await toLastStep();

  await fireEvent.press(cta());
  expect(await screen.findByText('같은 대사로 진행 중인 챌린지가 이미 있어요.')).toBeOnTheScreen();
  await fireEvent.press(cta());
  expect(await screen.findByText('적은 내용을 다시 확인해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(cta());
  expect(await screen.findByText('하루에 세 개까지 열 수 있어요. 내일 다시 열어 주세요.')).toBeOnTheScreen();

  const ids = createChallenge.mock.calls.map(([body]) => body.request_id);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[1]);
});

test('게스트는 회원만 이용할 수 있다고 안내받는다', async () => {
  createChallenge.mockRejectedValue(httpError(403));
  await render(<LineNewScreen />);
  await fill('잘 지내');
  await toLastStep();
  await fireEvent.press(cta());
  expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
});
