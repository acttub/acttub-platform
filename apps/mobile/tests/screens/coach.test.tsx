import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { ScrollView, TextInput } from 'react-native';

import CoachScreen from '@/app/coach';
import { logEvent } from '@/lib/analytics';
import { ApiError } from '@/lib/api-request';
import { clearPractice, getPractice, startPractice, takeContinueOrigin } from '@/lib/practice/session-state';
import type { CoachConversation, CoachMessage, CoachStreamCallbacks, CoachTurnResult, PracticeNote } from '@/lib/practice/types';
import { currentSpotlight } from '@/lib/spotlight-host';
import { currentTutorial, endTutorial, startTutorial } from '@/lib/tutorial';
import { createSampleLoop, SAMPLE_PRACTICE_ID, type LoopApi } from '@/lib/tutorial-sample';

const mockRouter = { replace: jest.fn(), dismissAll: jest.fn() };
const mockNavigation = { dispatch: jest.fn() };
let mockKeyboardHeight = 0;
let mockPreventRemove: { enabled: boolean; callback: (e: { data: { action: unknown } }) => void } | null = null;
const mockLoop = {
  getPractice: jest.fn(),
  getConversation: jest.fn(),
  getPracticeNote: jest.fn(),
  getPracticeAnalysis: jest.fn(),
  startConversation: jest.fn(),
  replyToCoach: jest.fn(),
};
let mockSampleLoop: LoopApi | null = null;

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    Stack: {
      Screen: ({ options }: { options?: { title?: string; headerRight?: () => unknown } }) => (
        <>
          <Text>{options?.title}</Text>
          {(options?.headerRight?.() ?? null) as never}
        </>
      ),
    },
    useRouter: () => mockRouter,
    // 회차 id 없이 열면 기다림 없이 들고 온 회차로 바로 대화한다(분석 대기는 coach-waiting.test.tsx).
    useLocalSearchParams: () => ({}),
    useFocusEffect: () => undefined,
  };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  usePreventRemove: (enabled: boolean, callback: (e: { data: { action: unknown } }) => void) => {
    mockPreventRemove = { enabled, callback };
  },
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({ loop: false, addListener: () => ({ remove: () => undefined }) })),
  VideoView: () => null,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
// 분석 대기(components/coach-waiting)가 부르는 것 — 회차 id 없이 여는 이 파일에서는 쓰이지 않는다(coach-waiting.test.tsx 가 본다).
jest.mock('@/lib/api', () => ({ api: {} }));
jest.mock('@/lib/library/library-runner', () => ({ localCopyFor: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ onPushReceived: () => () => undefined }));
jest.mock('@/hooks/use-keyboard-height', () => ({ useKeyboardHeight: () => mockKeyboardHeight }));
jest.mock('@/lib/tutorial-loop', () => ({
  loopApiFor: (practiceId: string | null | undefined) =>
    practiceId === 'tutorial-sample-practice' ? mockSampleLoop : mockLoop,
}));
jest.mock('@/components/mic-button', () => {
  const { Pressable, Text } = require('react-native');
  return {
    MicButton: ({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityLabel="음성 입력" disabled={disabled} onPress={() => onText('음성으로 적은 답')}>
        <Text>mic</Text>
      </Pressable>
    ),
  };
});

const SEND = '보내기';
const PLACEHOLDER = '직접 써도 돼요';
const LOADING = '코치가 첫 질문을 쓰고 있어요…';
const LOADING_HINT = '보통 20~30초쯤 걸려요. 화면을 나가도 질문은 계속 만들어지고, 홈에서 「대화 이어 가기」를 누르면 이어서 볼 수 있어요.';
const NOTE = { id: 'n1', title: '멈춤' } as PracticeNote;

function msg(turn: number, role: CoachMessage['role'], text: string): CoachMessage {
  return { turn_index: turn, role, text, created_at: null };
}

function conv(over: Partial<CoachConversation> = {}): CoachConversation {
  return {
    id: 'c1',
    practice_id: 'p1',
    status: 'open',
    close_reason: null,
    created_at: null,
    revision: 1,
    coach_reply_count: 1,
    reply_limit: 10,
    messages: [msg(0, 'coach', '첫 대사 전에 무엇을 결심했나요?')],
    ...over,
  };
}

function turn(conversation: CoachConversation, note: PracticeNote | null = null): CoachTurnResult {
  return { conversation, message: null, note };
}

const ANSWERED = conv({
  revision: 2,
  coach_reply_count: 2,
  messages: [
    msg(2, 'coach', '그때 시선은 어디에 있었나요?'),
    msg(0, 'coach', '첫 대사 전에 무엇을 결심했나요?'),
    msg(1, 'actor', '더는 미루지 않기로요'),
  ],
});

function begin(over: Partial<Parameters<typeof startPractice>[0]> = {}) {
  return startPractice({
    practiceId: 'p1',
    rootId: 'r1',
    ordinal: 2,
    scene: { situation: '카페에서 이별을 말하는 장면', character: '서연', goal: '담담하게' },
    videoUri: 'file:///take.mp4',
    playbackUrl: 'https://play/p1',
    ...over,
  });
}

const input = () => screen.getByPlaceholderText(PLACEHOLDER);
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const serverError = (status: number, code: string) => new ApiError(status, '서버 오류', code, code);
const scrollToEnd = (ScrollView.prototype as unknown as { scrollToEnd: jest.Mock }).scrollToEnd;

async function renderOpen() {
  begin();
  await render(<CoachScreen />);
  expect(await screen.findByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
}

async function typeAndSend(text: string) {
  await fireEvent.changeText(input(), text);
  await fireEvent.press(screen.getByRole('button', { name: SEND }));
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPractice();
  takeContinueOrigin();
  endTutorial();
  mockKeyboardHeight = 0;
  mockPreventRemove = null;
  mockSampleLoop = createSampleLoop({ delayMs: 0 });
  mockLoop.getPractice.mockResolvedValue({ conversation_id: null });
  mockLoop.startConversation.mockResolvedValue({ conversation: conv(), message: '첫 대사 전에 무엇을 결심했나요?', note: null });
  mockLoop.replyToCoach.mockResolvedValue(turn(ANSWERED));
  mockLoop.getPracticeAnalysis.mockRejectedValue(serverError(404, 'analysis_not_found'));
});

afterEach(() => {
  jest.useRealTimers();
});

test('진행 중인 연습이 없으면 홈에서 새로 시작하라고 안내한다', async () => {
  await render(<CoachScreen />);

  expect(screen.getByText('진행 중인 연습이 없어요. 홈에서 새로 시작해주세요.')).toBeOnTheScreen();
  expect(mockLoop.startConversation).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeOnTheScreen();
});

describe('대화 시작', () => {
  test('대화가 없으면 새로 시작하고 첫 질문을 보인다', async () => {
    let resolveStart: (r: CoachTurnResult) => void = () => undefined;
    mockLoop.startConversation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    begin();
    await render(<CoachScreen />);

    expect(screen.getByText(LOADING)).toBeOnTheScreen();
    expect(screen.getByText(LOADING_HINT)).toBeOnTheScreen();
    expect(screen.getByText('카페에서 이별을 말하는 장면')).toBeOnTheScreen();
    expect(screen.getByText('오늘 영상')).toBeOnTheScreen();
    expect(screen.getByText('장면 정보 있음')).toBeOnTheScreen();
    expect(input()).toBeDisabled();
    await waitFor(() => expect(mockLoop.startConversation).toHaveBeenCalled());
    expect(mockLoop.getPractice).toHaveBeenCalledWith('p1');
    const [practiceId, requestId] = mockLoop.startConversation.mock.calls[0];
    expect(practiceId).toBe('p1');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => resolveStart(turn(conv({ messages: [msg(0, 'coach', '  첫 질문이에요.\n둘째 줄  ')] }))));

    expect(screen.getByText('첫 질문이에요.\n둘째 줄')).toBeOnTheScreen();
    expect(screen.getByText('ACTTUB 코치')).toBeOnTheScreen();
    expect(screen.queryByText(LOADING)).not.toBeOnTheScreen();
    expect(screen.queryByText(LOADING_HINT)).not.toBeOnTheScreen();
    expect(screen.getByLabelText('답이나 질문을 편하게 적어 주세요')).toBeOnTheScreen();
    expect(input().props.maxLength).toBe(300);
    expect(input()).not.toBeDisabled();
    expect(getPractice()?.conversationId).toBe('c1');
  });

  test('코치가 쓰는 글은 첫 글자부터 말풍선에 자라고, 다시 쓰기 시작하면 비운다', async () => {
    let stream: CoachStreamCallbacks | undefined;
    let resolveStart: (r: CoachTurnResult) => void = () => undefined;
    mockLoop.startConversation.mockImplementation(
      (_id: string, _requestId: string, callbacks?: CoachStreamCallbacks) =>
        new Promise((resolve) => {
          stream = callbacks;
          resolveStart = resolve;
        }),
    );
    begin();
    await render(<CoachScreen />);
    await waitFor(() => expect(stream).toBeDefined());

    await act(async () => stream?.onDelta?.('그때 '));
    await act(async () => stream?.onDelta?.('무엇을 했나요?'));
    expect(screen.getByText('그때 무엇을 했나요?')).toBeOnTheScreen();
    expect(screen.queryByText(LOADING)).not.toBeOnTheScreen();

    await act(async () => stream?.onReset?.());
    expect(screen.getByText(LOADING)).toBeOnTheScreen();

    await act(async () => resolveStart(turn(conv())));
    expect(screen.getByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
  });

  test('대화가 먼저 열렸는데 코치 말이 없으면(미리 쓰기 중) 읽기만 하지 않고 시작 요청을 한 번 보낸다(SOMA-780)', async () => {
    mockLoop.getConversation.mockResolvedValue(conv({ coach_reply_count: 0, messages: [] }));
    mockLoop.startConversation.mockResolvedValue(turn(conv()));
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    expect(await screen.findByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
    expect(mockLoop.getConversation).toHaveBeenCalledTimes(1);
    expect(mockLoop.startConversation).toHaveBeenCalledTimes(1);
    expect(mockLoop.startConversation.mock.calls[0][0]).toBe('p1');
    expect(screen.queryByText(LOADING)).not.toBeOnTheScreen();
  });

  test('이미 시작한 대화는 같은 id 로 이어 가고 지난 문답을 펼쳐 볼 수 있다', async () => {
    mockLoop.getConversation.mockResolvedValue(ANSWERED);
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    expect(await screen.findByText('그때 시선은 어디에 있었나요?')).toBeOnTheScreen();
    expect(mockLoop.getConversation).toHaveBeenCalledWith('c1');
    expect(mockLoop.startConversation).not.toHaveBeenCalled();
    expect(screen.queryByText('더는 미루지 않기로요')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByText('지난 문답 1 ▾'));
    expect(screen.getByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
    // 내 답은 파란 말풍선(흰 글자), 코치 말은 회색 말풍선이다(SOMA-778).
    expect(screen.getByText('더는 미루지 않기로요')).toHaveStyle({ color: '#FFFFFF' });
    expect(screen.getByTestId('coach-bubble-mine')).toHaveStyle({ backgroundColor: '#4880EE' });
    expect(screen.getByTestId('coach-bubble-coach')).toHaveStyle({ backgroundColor: '#F2F4F6' });

    await fireEvent.press(screen.getByText('지난 문답 1 ▴'));
    expect(screen.queryByText('더는 미루지 않기로요')).not.toBeOnTheScreen();
  });

  test('연결에 실패하면 이유를 보이고, 다시 연결하면 같은 요청 id 로 시작한다', async () => {
    mockLoop.startConversation.mockRejectedValueOnce(serverError(409, 'analysis_not_ready'));
    begin();
    await render(<CoachScreen />);

    expect(await screen.findByText('분석이 아직 끝나지 않았어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('코치 다시 연결하기'));

    expect(await screen.findByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
    expect(screen.queryByText('분석이 아직 끝나지 않았어요.')).not.toBeOnTheScreen();
    expect(mockLoop.startConversation.mock.calls[1][1]).toBe(mockLoop.startConversation.mock.calls[0][1]);
  });

  test('시작이 끝나기 전에 화면을 떠나면 늦게 온 글과 결과를 버리고 회차에 대화를 붙이지 않는다', async () => {
    let stream: CoachStreamCallbacks | undefined;
    let resolveStart: (r: CoachTurnResult) => void = () => undefined;
    mockLoop.startConversation.mockImplementation(
      (_id: string, _requestId: string, callbacks?: CoachStreamCallbacks) =>
        new Promise((resolve) => {
          stream = callbacks;
          resolveStart = resolve;
        }),
    );
    begin();
    const view = await render(<CoachScreen />);
    await waitFor(() => expect(mockLoop.startConversation).toHaveBeenCalled());

    await view.unmount();
    await act(async () => {
      stream?.onDelta?.('늦게 온 글');
      stream?.onReset?.();
      resolveStart(turn(conv()));
    });
    expect(getPractice()?.conversationId).toBeNull();
  });

  test('시작이 실패하기 전에 화면을 떠나도 조용히 끝난다', async () => {
    let rejectStart: (e: unknown) => void = () => undefined;
    mockLoop.startConversation.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    begin();
    const view = await render(<CoachScreen />);
    await waitFor(() => expect(mockLoop.startConversation).toHaveBeenCalled());

    await view.unmount();
    await act(async () => rejectStart(serverError(500, 'internal_error')));
    expect(getPractice()?.conversationId).toBeNull();
  });
});

describe('답 보내기', () => {
  test('빈 칸이면 보낼 수 없고, 쓴 답을 다듬어 보내면 다음 질문을 보이고 칸을 비운다', async () => {
    let resolveReply: (r: CoachTurnResult) => void = () => undefined;
    mockLoop.replyToCoach.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReply = resolve;
        }),
    );
    await renderOpen();
    expect(screen.getByRole('button', { name: SEND })).toBeDisabled();

    await typeAndSend('  더는 미루지 않기로요  ');
    expect(screen.getByRole('button', { name: SEND })).toBeDisabled();
    expect(screen.getByText('답을 듣고 생각 중이에요…')).toBeOnTheScreen();
    expect(input()).toBeDisabled();
    const [body] = mockLoop.replyToCoach.mock.calls[0];
    expect(body).toEqual({ conversation_id: 'c1', request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: '더는 미루지 않기로요', revision: 1 });

    await act(async () => resolveReply(turn(ANSWERED)));
    expect(screen.getByText('그때 시선은 어디에 있었나요?')).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('');
    expect(screen.getByText('지난 문답 1 ▾')).toBeOnTheScreen();
  });

  test('글자 수를 세고 300자를 넘으면 보낼 수 없다', async () => {
    await renderOpen();

    await fireEvent.changeText(input(), '가'.repeat(301));
    expect(input().props.maxLength).toBe(300);
    expect(screen.getByRole('button', { name: SEND })).toBeDisabled();
  });

  test('같은 답을 다시 보내면 같은 요청 id 를, 고쳐 쓰면 새 id 를 쓴다', async () => {
    mockLoop.replyToCoach.mockRejectedValueOnce(new ApiError(503, '불안정')).mockRejectedValueOnce(new ApiError(503, '불안정'));
    await renderOpen();

    await typeAndSend('첫 답');
    expect(await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 보내 주세요.')).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('첫 답');
    await fireEvent.press(screen.getByRole('button', { name: SEND }));
    await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 보내 주세요.');
    await typeAndSend('고친 답');
    expect(await screen.findByText('그때 시선은 어디에 있었나요?')).toBeOnTheScreen();

    const ids = mockLoop.replyToCoach.mock.calls.map(([body]) => body.request_id);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  test('요청이 바뀌었다고 거절되면 같은 답도 새 요청 id 로 보낸다', async () => {
    mockLoop.replyToCoach.mockRejectedValueOnce(serverError(409, 'request_fingerprint_mismatch'));
    await renderOpen();

    await typeAndSend('첫 답');
    expect(await screen.findByText('요청 내용이 바뀌었어요. 다시 보내 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: SEND }));
    await screen.findByText('그때 시선은 어디에 있었나요?');

    const ids = mockLoop.replyToCoach.mock.calls.map(([body]) => body.request_id);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test.each([
    [serverError(422, 'validation_error'), '답은 300자까지 쓸 수 있어요.'],
    [new ApiError(400, '잘못된 요청'), '전송에 실패했어요.'],
  ])('보내기가 실패하면 이유를 보이고 쓴 글을 남긴다 (%s)', async (error, message) => {
    mockLoop.replyToCoach.mockRejectedValueOnce(error);
    await renderOpen();

    await typeAndSend('첫 답');
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('첫 답');
    expect(screen.queryByText('코치 다시 연결하기')).not.toBeOnTheScreen();
  });

  test('다른 곳에서 먼저 답이 들어갔으면 쓰던 글을 두고 최신 대화를 다시 읽는다', async () => {
    mockLoop.replyToCoach.mockRejectedValueOnce(serverError(409, 'conversation_conflict'));
    mockLoop.getConversation.mockResolvedValue(ANSWERED);
    await renderOpen();

    await typeAndSend('내 답');
    expect(
      await screen.findByText('다른 곳에서 먼저 답이 들어갔어요. 대화를 다시 불러올게요 — 쓰던 글은 그대로예요.'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('그때 시선은 어디에 있었나요?')).toBeOnTheScreen();
    expect(mockLoop.getConversation).toHaveBeenCalledWith('c1');
    expect(input()).toHaveDisplayValue('내 답');
  });

  test('최신 대화를 다시 못 읽으면 보던 질문을 그대로 둔다', async () => {
    mockLoop.replyToCoach.mockRejectedValueOnce(serverError(409, 'conversation_conflict'));
    mockLoop.getConversation.mockRejectedValue(new Error('down'));
    await renderOpen();

    await typeAndSend('내 답');
    await waitFor(() => expect(mockLoop.getConversation).toHaveBeenCalledWith('c1'));
    expect(screen.getByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('내 답');
  });

  test('이미 닫힌 대화면 닫혔다고 알리고 닫힌 대화를 다시 읽어 입력칸을 거둔다', async () => {
    mockLoop.replyToCoach.mockRejectedValueOnce(serverError(409, 'conversation_closed'));
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'limit' }));
    mockLoop.getPracticeNote.mockRejectedValue(serverError(404, 'note_not_found'));
    await renderOpen();

    await typeAndSend('내 답');
    expect(await screen.findByText('이 대화는 마쳤어요. 이어서 하려면 새 회차로 시작해요.')).toBeOnTheScreen();
    expect(await screen.findByText('오늘은 여기까지 나눴어요. 노트로 남기기엔 짧아서, 다음에 이어서 해요.')).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeOnTheScreen();
    expect(mockLoop.getPracticeNote).toHaveBeenCalledWith('p1');
  });

  test('답이 오기 전에 화면을 떠나면 회차에 노트를 붙이지 않는다', async () => {
    let resolveReply: (r: CoachTurnResult) => void = () => undefined;
    mockLoop.replyToCoach.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReply = resolve;
        }),
    );
    begin();
    const view = await render(<CoachScreen />);
    await screen.findByText('첫 대사 전에 무엇을 결심했나요?');
    await typeAndSend('내 답');

    await view.unmount();
    await act(async () => resolveReply(turn(conv({ status: 'closed', close_reason: 'exhausted' }), NOTE)));
    expect(getPractice()?.note).toBeNull();
  });

  test('답이 실패하기 전에 화면을 떠나면 다시 읽지 않는다', async () => {
    let rejectReply: (e: unknown) => void = () => undefined;
    mockLoop.replyToCoach.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectReply = reject;
        }),
    );
    begin();
    const view = await render(<CoachScreen />);
    await screen.findByText('첫 대사 전에 무엇을 결심했나요?');
    await typeAndSend('내 답');

    await view.unmount();
    await act(async () => rejectReply(serverError(409, 'conversation_conflict')));
    expect(mockLoop.getConversation).not.toHaveBeenCalled();
    expect(mockLoop.replyToCoach).toHaveBeenCalledTimes(1);
  });

  test('다음 답이 마지막 코치 응답이면 마무리한다고 미리 알린다', async () => {
    mockLoop.startConversation.mockResolvedValue(turn(conv({ coach_reply_count: 9, reply_limit: 10 })));
    await renderOpen();

    expect(screen.getByText('다음 답으로 마무리해요')).toBeOnTheScreen();
  });
});

describe('빠른 답과 그만하기', () => {
  test('빠른 답은 2×2 — 맞아요·아니요·잘 모르겠어요는 입력칸만 채우고 보내지 않는다', async () => {
    await renderOpen();

    const chips = ['맞아요', '아니요', '잘 모르겠어요', '직접 쓰기'].map((name) => screen.getByRole('button', { name }));
    expect(chips).toHaveLength(4);
    expect(screen.getByTestId('coach-quick-grid')).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' });
    await fireEvent.press(screen.getByRole('button', { name: '맞아요' }));
    expect(input()).toHaveDisplayValue('맞아요');
    await fireEvent.press(screen.getByRole('button', { name: '아니요' }));
    expect(input()).toHaveDisplayValue('아니요');
    await fireEvent.press(screen.getByRole('button', { name: '잘 모르겠어요' }));
    expect(input()).toHaveDisplayValue('잘 모르겠어요');
    expect(mockLoop.replyToCoach).not.toHaveBeenCalled();
  });

  test('직접 쓰기는 입력칸에 커서만 두고 쓰던 글은 그대로 둔다', async () => {
    const focus = jest.spyOn(TextInput.prototype as unknown as { focus: () => void }, 'focus');
    await renderOpen();
    await fireEvent.changeText(input(), '쓰던 글');
    focus.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: '직접 쓰기' }));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(input()).toHaveDisplayValue('쓰던 글');
    expect(mockLoop.replyToCoach).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  test('마이크로 받아 적은 글이 입력칸에 들어간다', async () => {
    await renderOpen();

    await fireEvent.press(screen.getByRole('button', { name: '음성 입력' }));
    expect(input()).toHaveDisplayValue('음성으로 적은 답');
  });

  test('그만하기는 확인을 받고 "그만"을 보내 대화를 마친다', async () => {
    mockLoop.replyToCoach.mockResolvedValue(turn(conv({ status: 'closed', close_reason: 'user_ended' })));
    await renderOpen();

    await fireEvent.press(screen.getByRole('button', { name: '그만하기' }));
    expect(screen.getByText('여기서 마칠까요?')).toBeOnTheScreen();
    expect(screen.getByText('다 얘기했으면 「마치기」를 누르세요. 지금까지 대화로 오늘 정리를 만들어요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('계속하기'));
    expect(mockLoop.replyToCoach).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: '그만하기' }));
    await fireEvent.press(screen.getByText('마치기'));
    expect(await screen.findByText('오늘은 여기까지 나눴어요. 노트로 남기기엔 짧아서, 다음에 이어서 해요.')).toBeOnTheScreen();
    expect(mockLoop.replyToCoach.mock.calls[0][0]).toMatchObject({ conversation_id: 'c1', text: '그만', revision: 1 });
  });
});

describe('닫힌 대화', () => {
  test('노트와 함께 닫히면 정리 화면으로 넘어간다', async () => {
    jest.useFakeTimers();
    mockLoop.replyToCoach.mockResolvedValue(turn(conv({ status: 'closed', close_reason: 'exhausted' }), NOTE));
    await renderOpen();

    await typeAndSend('마지막 답');
    expect(screen.getByText('오늘 대화는 여기까지예요. 정리를 만들어 보여드릴게요.')).toBeOnTheScreen();
    expect(getPractice()?.note).toEqual(NOTE);
    await act(async () => jest.advanceTimersByTime(0));
    expect(mockRouter.replace).toHaveBeenCalledWith('/report');

    await fireEvent.press(screen.getByRole('button', { name: '정리 보러 가기' }));
    await act(async () => jest.advanceTimersByTime(0));
    expect(mockRouter.replace.mock.calls).toEqual([['/report'], ['/report']]);
  });

  test('닫힌 대화로 다시 들어오면 노트를 읽어 정리 화면으로 넘어간다', async () => {
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'exhausted' }));
    mockLoop.getPracticeNote.mockResolvedValue(NOTE);
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/report'));
    expect(mockLoop.getPracticeNote).toHaveBeenCalledWith('p1');
    expect(mockLoop.startConversation).not.toHaveBeenCalled();
  });

  test('노트 없이 닫히면 연습을 마치고 나갈 수 있다', async () => {
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'user_ended' }));
    mockLoop.getPracticeNote.mockRejectedValue(serverError(404, 'note_not_found'));
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '연습 마치기' }));
    await waitFor(() => expect(mockRouter.dismissAll).toHaveBeenCalled());
    expect(getPractice()).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('마무리 중 연결이 끊겨 닫혔으면 그렇다고 알린다', async () => {
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'system_failure' }));
    mockLoop.getPracticeNote.mockRejectedValue(serverError(404, 'note_not_found'));
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    expect(
      await screen.findByText('대화를 마무리하는 중 연결이 끊겼어요. 남아 있는 기록을 확인하거나 새 회차로 이어갈 수 있어요.'),
    ).toBeOnTheScreen();
  });

  test('다음 테이크 찍기는 이 묶음에 이어 새 영상을 고르러 간다', async () => {
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'user_ended' }));
    mockLoop.getPracticeNote.mockRejectedValue(serverError(404, 'note_not_found'));
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '다음 테이크 찍기' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/upload'));
    expect(takeContinueOrigin()).toEqual({ kind: 'group', rootId: 'r1', practiceId: 'p1' });
    expect(getPractice()).toBeNull();
  });

  test('화면 전환이 실패해도 앱은 그대로 둔다', async () => {
    jest.useFakeTimers();
    mockRouter.dismissAll.mockImplementation(() => {
      throw new Error('stack mismatch');
    });
    mockLoop.getConversation.mockResolvedValue(conv({ status: 'closed', close_reason: 'user_ended' }));
    mockLoop.getPracticeNote.mockRejectedValue(serverError(404, 'note_not_found'));
    begin({ conversationId: 'c1' });
    await render(<CoachScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '연습 마치기' }));
    await act(async () => jest.advanceTimersByTime(0));
    expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '연습 마치기' })).toBeOnTheScreen();
  });
});

describe('영상과 장면 보기', () => {
  test('펼치면 기기의 영상을 틀고 펼친 것을 남긴다, 접을 때는 남기지 않는다', async () => {
    await renderOpen();

    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' }));
    expect(useVideoPlayer).toHaveBeenLastCalledWith('file:///take.mp4', expect.any(Function));
    expect(screen.getByRole('button', { name: '영상과 장면 보기 접기' })).toBeExpanded();
    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 접기' }));

    expect(logged('video_fold_open')).toEqual([{ screen: 'coach' }]);
    expect(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' })).toBeOnTheScreen();
  });

  test('기기 복사본이 없으면 재생 주소로 틀고, 장면이 없으면 대체 제목과 다시 보기 안내를 보인다', async () => {
    begin({ videoUri: '', scene: { situation: '   ', character: '', goal: '' } });
    await render(<CoachScreen />);
    await screen.findByText('첫 대사 전에 무엇을 결심했나요?');

    expect(screen.getByText('질문 대화')).toBeOnTheScreen();
    // 장면 칸이 없어졌으니(SOMA-778) 「장면을 적지 않았어요」라고 탓하지 않는다.
    expect(screen.queryByText('장면을 적지 않았어요')).not.toBeOnTheScreen();
    expect(screen.getByText('누르면 영상을 다시 봐요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' }));
    expect(useVideoPlayer).toHaveBeenLastCalledWith('https://play/p1', expect.any(Function));
  });
});

describe('AI가 본 장면 한 줄', () => {
  const analysis = (observed: string[]) => ({
    id: 'a1',
    format: 'video_record_v1',
    status: 'ready',
    summary: { schema_version: 'acttub.video_record_summary.v1', observed_scene: observed },
  });

  test('분석 요약의 본 장면 첫 줄을 대화 위에 한 줄로 보이고, 고치기 버튼은 아직 없다', async () => {
    mockLoop.getPracticeAnalysis.mockResolvedValue(analysis(['카페에서 컵을 내려놓고 말을 꺼낸다', '둘째 줄']));
    await renderOpen();

    expect(await screen.findByText('AI가 본 장면 · 카페에서 컵을 내려놓고 말을 꺼낸다')).toBeOnTheScreen();
    expect(mockLoop.getPracticeAnalysis).toHaveBeenCalledWith('p1');
    expect(screen.queryByText('둘째 줄')).not.toBeOnTheScreen();
    // 「고치기」는 서버 API 가 없어 두지 않는다.
    expect(screen.queryByRole('button', { name: '고치기' })).not.toBeOnTheScreen();
  });

  test.each([
    ['요약을 못 읽음', () => mockLoop.getPracticeAnalysis.mockRejectedValue(serverError(404, 'analysis_not_found'))],
    ['본 장면이 비었음', () => mockLoop.getPracticeAnalysis.mockResolvedValue(analysis([]))],
  ])('%s 이면 줄을 숨긴다', async (_name, arrange) => {
    arrange();
    await renderOpen();
    await waitFor(() => expect(mockLoop.getPracticeAnalysis).toHaveBeenCalled());
    expect(screen.queryByText(/AI가 본 장면/)).not.toBeOnTheScreen();
  });
});

describe('스크롤', () => {
  test('새 질문이 오면 끝으로, 키보드가 뜨면 다시 끝으로 내린다', async () => {
    jest.useFakeTimers();
    begin();
    const view = await render(<CoachScreen />);
    await act(async () => jest.advanceTimersByTime(50));
    expect(screen.getByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });

    scrollToEnd.mockClear();
    mockKeyboardHeight = 320;
    await view.rerender(<CoachScreen />);
    await act(async () => jest.advanceTimersByTime(80));
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });
});

describe('튜토리얼 예시', () => {
  function beginSample() {
    startTutorial('sample');
    return begin({
      practiceId: SAMPLE_PRACTICE_ID,
      rootId: SAMPLE_PRACTICE_ID,
      ordinal: 1,
      videoUri: 'file:///sample.mp4',
      playbackUrl: null,
    });
  }

  test('미리 쓴 코치와 대화하고, 질문마다 샘플 답을 채워 두며, 두 답 뒤에 정리로 간다', async () => {
    beginSample();
    await render(<CoachScreen />);

    expect(
      await screen.findByText('첫 대사 직전에 컵을 내려놓는 순간이 있었어요. 그때 서연은 무엇을 결심하고 있었나요?'),
    ).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('컵을 내려놓으면서 더는 미루지 않겠다고 마음먹었어요.');
    expect(screen.queryByRole('button', { name: '음성 입력' })).not.toBeOnTheScreen();
    expect(currentSpotlight()?.steps).toEqual([
      { target: 'coach.question', text: 'tutorial.coQuestion' },
      { target: 'coach.composer', text: 'tutorial.coAnswer' },
    ]);

    await fireEvent.press(screen.getByRole('button', { name: SEND }));
    expect(
      await screen.findByText('"우리 그만하자"를 말하고 바로 시선을 피했어요. 상대의 얼굴을 보지 않은 건 의도한 선택이었나요?'),
    ).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue('네, 얼굴을 보면 말을 못 끝낼 것 같아서 일부러 피했어요.');

    await typeAndSend('제가 고쳐 쓴 답');
    expect(await screen.findByText('좋아요. 나눈 이야기를 연습 노트로 정리할게요.')).toBeOnTheScreen();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/report'));
    expect(screen.queryByRole('button', { name: '다음 테이크 찍기' })).not.toBeOnTheScreen();
    expect(getPractice()?.note?.actor_words).toEqual(['컵을 내려놓으면서 더는 미루지 않겠다고 마음먹었어요.']);
  });

  test('대화 중에 뒤로 가면 튜토리얼을 나감으로 끝내고 그 이동을 이어 간다', async () => {
    jest.useFakeTimers();
    beginSample();
    await render(<CoachScreen />);
    expect(mockPreventRemove?.enabled).toBe(true);

    const action = { type: 'GO_BACK' };
    await act(async () => mockPreventRemove?.callback({ data: { action } }));
    expect(currentTutorial()).toBeNull();
    expect(logged('tutorial_finish')).toEqual([{ mode: 'sample', track: 'practice', how: 'left' }]);
    expect(mockPreventRemove?.enabled).toBe(false);

    await act(async () => jest.advanceTimersByTime(0));
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
  });

  test('실제 회차에서는 뒤로 가기를 막지 않는다', async () => {
    await renderOpen();
    expect(mockPreventRemove?.enabled).toBe(false);
  });
});

test('음성 인식 모듈이 없는 빌드에서도 마이크 없이 화면이 뜬다', async () => {
  const outerReact = jest.requireActual('react');
  jest.resetModules();
  jest.doMock('react', () => outerReact);
  jest.doMock('@/components/mic-button', () => {
    throw new Error('native module missing');
  });
  const IsolatedCoach: typeof CoachScreen = require('@/app/coach').default;
  require('@/lib/practice/session-state').startPractice({
    practiceId: 'p1',
    rootId: 'r1',
    ordinal: 1,
    scene: { situation: '장면', character: '', goal: '' },
    videoUri: '',
    playbackUrl: null,
  });

  await render(<IsolatedCoach />);
  expect(await screen.findByText('첫 대사 전에 무엇을 결심했나요?')).toBeOnTheScreen();
  expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '음성 입력' })).not.toBeOnTheScreen();
});
