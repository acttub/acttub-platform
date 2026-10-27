import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SampleScriptPicker from '@/app/reading/sample';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { loadIntoCurrent } from '@/lib/reading/store';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/lib/api', () => ({
  api: { listReadingExamples: jest.fn(), startReadingExample: jest.fn() },
}));
jest.mock('@/lib/reading/store', () => ({ loadIntoCurrent: jest.fn(), updateScriptMeta: jest.fn() }));
jest.mock('@/lib/tutorial', () => ({ currentTutorial: () => null, afterVoicesSaved: () => 'detail' }));

const SERVER = {
  examples: [
    {
      id: 'ex-hall',
      title: '복도, 아침',
      summary: '하린 · 도윤 · 2인 대화',
      dialogue_count: 9,
      characters: ['하린', '도윤'],
      preview: [{ speaker: '하린', text: '오늘 발표 너야?' }],
    },
    {
      id: 'ex-bus',
      title: '버스 정류장',
      summary: '혼자 읽는 독백',
      dialogue_count: 0,
      characters: ['나'],
      preview: [{ speaker: null, text: '버스가 또 늦는다.' }],
    },
  ],
};

const savedScript = { id: 's9', title: '복도, 아침', characters: [{ id: 'c1', name: '하린', unnamed: false }, { id: 'c2', name: '도윤', unnamed: false }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  jest.mocked(api.listReadingExamples).mockResolvedValue(SERVER);
  jest.mocked(api.startReadingExample).mockResolvedValue({ script_id: 's9', created: true });
  jest.mocked(loadIntoCurrent).mockResolvedValue(savedScript as never);
});

test('서버 예시 목록을 보여 주고 칩으로 바꿔 본다', async () => {
  await render(<SampleScriptPicker />);
  expect(screen.getByText('이 대본으로 해 볼까요?')).toBeOnTheScreen();
  await waitFor(() => expect(screen.getAllByText('복도, 아침').length).toBeGreaterThan(0));
  expect(screen.getByText('오늘 발표 너야?')).toBeOnTheScreen();
  expect(screen.getByText('하린 · 도윤 · 2인 대화 · 대사 9줄')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('radio', { name: '버스 정류장' }));
  expect(screen.getByText('버스가 또 늦는다.')).toBeOnTheScreen();
  expect(screen.queryByRole('radio', { name: '옥상, 밤' })).toBeNull();
});

test('불러오는 동안에도 빈 화면 없이 내장 목록을 보여 준다', async () => {
  jest.mocked(api.listReadingExamples).mockReturnValue(new Promise(() => {}));
  await render(<SampleScriptPicker />);
  expect(screen.getAllByText('옥상, 밤').length).toBeGreaterThan(0);
});

test('목록을 못 받으면(옛 서버 404 포함) 내장 예시로 보이고, 고르면 지금처럼 대본 넣기로 간다', async () => {
  jest.mocked(api.listReadingExamples).mockRejectedValue(new ApiError(404, 'not found', 'not_found'));
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(api.listReadingExamples).toHaveBeenCalled());
  expect(screen.getAllByText('옥상, 밤').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('radio', { name: '카페, 헤어지자는 말' }));
  expect(screen.getAllByText('서연')[0]).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/reading/new', params: { sample: 'cafe' } });
  expect(api.startReadingExample).not.toHaveBeenCalled();
});

test('서버 예시를 고르면 복사(start) → 대본 불러오기 → 대본 상세로 간다', async () => {
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '버스 정류장' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('radio', { name: '복도, 아침' }));
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  expect(api.startReadingExample).toHaveBeenCalledWith('ex-hall', expect.objectContaining({ request_id: expect.any(String) }));
  expect(loadIntoCurrent).toHaveBeenCalledWith('s9');
  expect(jest.mocked(api.startReadingExample).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(loadIntoCurrent).mock.invocationCallOrder[0]);
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('복사 중에는 버튼이 막혀 두 번 눌러도 한 번만 보낸다', async () => {
  let finish: (v: { script_id: string; created: boolean }) => void = () => {};
  jest.mocked(api.startReadingExample).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '버스 정류장' })).toBeOnTheScreen());
  const button = screen.getByRole('button', { name: '이 대본으로 하기' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(api.startReadingExample).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '이 대본으로 하기' })).toBeDisabled();
  await act(async () => finish({ script_id: 's9', created: false }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
});

test('대본이 가득 차면(422 script_limit) 한도 안내를 띄우고 화면에 남는다', async () => {
  jest.mocked(api.startReadingExample).mockRejectedValue(new ApiError(422, 'limit', 'script_limit', 'script_limit'));
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '버스 정류장' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  expect(await screen.findByText('대본은 100개까지 둘 수 있어요. 안 쓰는 대본을 지우면 다시 저장할 수 있어요.')).toBeOnTheScreen();
  expect(loadIntoCurrent).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '이 대본으로 하기' })).toBeEnabled();
});

test('그 밖의 실패는 공용 오류 안내이고, 다시 누르면 같은 요청 id 로 보낸다', async () => {
  jest.mocked(api.startReadingExample).mockRejectedValueOnce(new ApiError(500, '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'));
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '버스 정류장' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  expect(await screen.findByText('서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(screen.getByText('예시 대본을 열지 못했어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '확인' }));
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/reading/detail'));
  const [first, second] = jest.mocked(api.startReadingExample).mock.calls;
  expect(second[1].request_id).toBe(first[1].request_id);
});

test('복사는 됐는데 대본을 못 불러오면 공용 안내를 띄우고 남는다', async () => {
  jest.mocked(loadIntoCurrent).mockResolvedValue(null);
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByRole('radio', { name: '버스 정류장' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  expect(await screen.findByText('네트워크 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('입시생으로 들어오면(?exam=1) 입시 예시를 맨 앞에 두고 골라 둔다(SOMA-864)', async () => {
  mockParams = { exam: '1' };
  jest.mocked(api.listReadingExamples).mockResolvedValue({
    examples: [
      ...SERVER.examples,
      { id: 'exam-brother', title: '형에게', summary: '도윤 · 독백 · 입시', dialogue_count: 7, characters: ['도윤'], preview: [{ speaker: '도윤', text: '형, 나야. 받지 마. 그냥 들어.' }], category: 'exam' },
    ],
  } as never);
  await render(<SampleScriptPicker />);
  await waitFor(() => expect(screen.getByText('형, 나야. 받지 마. 그냥 들어.')).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  await waitFor(() => expect(api.startReadingExample).toHaveBeenCalledWith('exam-brother', expect.anything()));
});
