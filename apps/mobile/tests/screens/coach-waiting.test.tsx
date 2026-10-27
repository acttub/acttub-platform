import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { AppState } from 'react-native';

import CoachScreen from '@/app/coach';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { localCopyFor } from '@/lib/library/library-runner';
import { clearPractice, getPractice } from '@/lib/practice/session-state';
import type { CoachConversation, PracticeDetail, PracticeStatus } from '@/lib/practice/types';
import { currentSpotlight } from '@/lib/spotlight-host';
import { currentTutorial, endTutorial, startTutorial } from '@/lib/tutorial';
import { createSampleLoop, SAMPLE_PRACTICE_ID, type LoopApi } from '@/lib/tutorial-sample';

/**
 * 분석 대기(옛 A10 analyzing 화면)는 코치 화면 안의 「영상 보는 중」이다(SOMA-778). 옛 analyzing 화면 테스트를 그대로 옮겼다 —
 * 조회 주기·푸시·복귀·그만두기·다시 시도·복구 기록·튜토리얼 예시. 「코치로 넘어간다」는 이제 같은 화면에서 대화가 열리는 것이다.
 */
const mockRouter = { dismissTo: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() };
const mockNavDispatch = jest.fn();
let mockParams: Record<string, unknown> = {};
let mockUser: { id: string } | null = { id: 'u1' };
let mockFocusEffect: () => (() => void) | void = () => undefined;
let mockBlur: () => void = () => undefined;
let mockPushListener: ((data: unknown) => void) | null = null;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  const { Text } = require('react-native');
  return {
    Stack: { Screen: ({ options }: { options?: { title?: string } }) => <Text>{options?.title}</Text> },
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => () => void) => {
      mockFocusEffect = effect;
      useEffect(() => {
        const cleanup = effect();
        mockBlur = cleanup;
        return cleanup;
      }, [effect]);
    },
  };
});
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({ loop: false, addListener: () => ({ remove: () => undefined }) })),
  VideoView: () => null,
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
const QUESTION = '첫 대사 전에 무엇을 결심했나요?';
const mockLoop = {
  getPractice: jest.fn(),
  getConversation: jest.fn(),
  getPracticeNote: jest.fn(),
  getPracticeAnalysis: jest.fn(),
  startConversation: jest.fn(),
  replyToCoach: jest.fn(),
};
let mockSampleLoop: LoopApi | null = null;
jest.mock('@/lib/tutorial-loop', () => ({
  sampleVideoUri: () => 'file:///sample.mp4',
  loopApiFor: (practiceId: string | null | undefined) => (practiceId === 'tutorial-sample-practice' ? mockSampleLoop : mockLoop),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockNavDispatch }),
  usePreventRemove: jest.fn(),
}));
jest.mock('@/components/mic-button', () => ({ MicButton: () => null }));
jest.mock('@/lib/notifications', () => ({
  onPushReceived: (listener: (data: unknown) => void) => {
    mockPushListener = listener;
    return () => {
      mockPushListener = null;
    };
  },
}));
jest.mock('@/lib/library/library-runner', () => ({ localCopyFor: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    getPractice: jest.fn(),
    getPracticeGroup: jest.fn(),
    getPracticeStatus: jest.fn(),
    cancelPractice: jest.fn(),
    retryPracticeAnalysis: jest.fn(),
    listPracticeGroups: jest.fn(),
  },
}));

const STAGES = [
  '장면을 처음부터 끝까지 보고 있어요…',
  '대사·템포·움직임·표정을 뜯어보는 중…',
  '의도와 견주어 보는 중이에요…',
  '거의 다 됐어요. 정리하고 있어요…',
];
const QUEUED = '차례를 기다리는 중이에요…';
const WATCHING = '영상 보는 중이에요';
const STATUS_UNAVAILABLE = '진행 상태를 읽지 못했어요. 잠시 뒤 기록에서 다시 확인해 주세요.';
const PENDING_KEY = 'acttub.pendingAnalysis:u1:p1:p1';

const getStatus = api.getPracticeStatus as jest.Mock;
const getPracticeApi = api.getPractice as jest.Mock;
const logged = (name: string) => (logEvent as jest.Mock).mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const serverError = (status: number, code: string) => new ApiError(status, '서버 오류', code, code);
const never = () => new Promise<never>(() => undefined);

function status(over: Partial<PracticeStatus> = {}): PracticeStatus {
  return { stage: 'analyzing', close_reason: null, job: { id: 'j1', status: 'running' }, analysis_status: null, ...over };
}
const READY = status({ stage: 'conversing', analysis_status: 'ready', job: { id: 'j1', status: 'succeeded' } });
const FAILED = (reason: string | null) => status({ stage: 'closed', job: { id: 'j1', status: 'failed', failure_reason: reason } });

function detail(over: Partial<PracticeDetail> = {}): PracticeDetail {
  return {
    id: 'p1',
    root_id: 'r1',
    ordinal: 2,
    stage: 'analyzing',
    analysis_status: null,
    job: null,
    video_id: 'v1',
    scene: { situation: '이별을 말하는 장면', character: '서연', goal: '담담하게' },
    blockage: { category: '표현', detail: '감정', note: '울컥하는 타이밍' },
    created_at: '2026-10-01T00:00:00Z',
    playback_url: 'https://play/v1',
    video_purged: false,
    conversation_id: 'c1',
    previous_conversations: [],
    ...over,
  };
}

function conv(): CoachConversation {
  return {
    id: 'c1',
    practice_id: 'p1',
    status: 'open',
    close_reason: null,
    created_at: null,
    revision: 1,
    coach_reply_count: 1,
    reply_limit: 10,
    messages: [{ turn_index: 0, role: 'coach', text: QUESTION, created_at: null }],
  };
}

/** 분석이 끝나 같은 화면에서 대화가 열렸다(옛 router.replace('/coach')). */
async function entersCoach() {
  expect(await screen.findByText(QUESTION)).toBeOnTheScreen();
  expect(screen.queryByText(WATCHING)).not.toBeOnTheScreen();
}
/** 대화가 열리지 않았다 — 입력칸이 없다. */
function staysWaiting() {
  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
  expect(screen.queryByPlaceholderText('직접 써도 돼요')).not.toBeOnTheScreen();
  // 분석이 끝나기 전에는 대화를 열지 않는다(/v2/coach/start 는 409 analysis_not_ready).
  expect(mockLoop.startConversation).not.toHaveBeenCalled();
}

async function pendingKeys() {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('acttub.pendingAnalysis:'));
}

let appStateListener: ((next: string) => void) | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { practiceId: 'p1' };
  mockUser = { id: 'u1' };
  mockPushListener = null;
  appStateListener = null;
  clearPractice();
  endTutorial();
  await AsyncStorage.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (next: string) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  getPracticeApi.mockResolvedValue(detail());
  (api.getPracticeGroup as jest.Mock).mockResolvedValue({ title: '  서연의 이별  ' });
  (localCopyFor as jest.Mock).mockResolvedValue('file:///local/v1.mp4');
  getStatus.mockResolvedValue(status());
  mockSampleLoop = createSampleLoop({ delayMs: 0 });
  mockLoop.getPractice.mockResolvedValue({ conversation_id: 'c1' });
  mockLoop.getConversation.mockResolvedValue(conv());
  mockLoop.startConversation.mockResolvedValue({ conversation: conv(), message: QUESTION, note: null });
  mockLoop.getPracticeAnalysis.mockRejectedValue(new Error('analysis_not_found'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('기다리는 동안', () => {
  test('차례를 기다리는 동안 대기 문구와 나가도 되는 길을 보여 주고, 앱을 다시 켜도 돌아오게 기록한다', async () => {
    getStatus.mockResolvedValue(status({ job: { id: 'j1', status: 'pending' } }));
    await render(<CoachScreen />);

    expect(await screen.findByText(QUEUED)).toBeOnTheScreen();
    // 따로 된 분석 화면이 아니라 대화 화면 안의 코치 말풍선이다.
    expect(screen.getByText('질문 대화')).toBeOnTheScreen();
    expect(screen.getByText(WATCHING)).toBeOnTheScreen();
    expect(screen.getByText('코치')).toBeOnTheScreen();
    expect(screen.queryByText('3단계 · 질문 준비 중')).not.toBeOnTheScreen();
    staysWaiting();
    expect(screen.getByText('0초 경과')).toBeOnTheScreen();
    expect(screen.getByText('화면을 나가도 분석은 계속돼요')).toBeOnTheScreen();
    expect(screen.getByText('보통 30초쯤 걸려요. 다 되면 알림으로 알려 드릴게요.')).toBeOnTheScreen();
    expect(getStatus).toHaveBeenCalledWith('p1', { signal: expect.any(AbortSignal) });
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1'));
    await waitFor(async () => expect(await pendingKeys()).toEqual([PENDING_KEY]));
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) as string)).toEqual({
      schemaVersion: 2,
      owner: 'u1',
      practice_id: 'p1',
    });

    // 기다리지 않고 나가면 코칭 탭 첫 화면으로 간다 — 분석은 서버에서 계속 돌고 끝나면 알림이 온다.
    await fireEvent.press(screen.getByRole('button', { name: '끝나면 알려 주세요' }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/coaching');
  });

  test('영상 보는 중에 뒤로 가면 코칭 탭 첫 화면으로 간다', async () => {
    getStatus.mockResolvedValue(status({ job: { id: 'j1', status: 'pending' } }));
    await render(<CoachScreen />);
    expect(await screen.findByText(QUEUED)).toBeOnTheScreen();
    staysWaiting();

    const preventRemove = jest.requireMock('@react-navigation/native').usePreventRemove as jest.Mock;
    const back = preventRemove.mock.calls.filter(([on]) => on).at(-1)[1];
    await act(async () => back({ data: { action: { type: 'POP' } } }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/coaching');
    expect(preventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  test('영상 보는 중에도 뒤로 가기가 아닌 이동(다른 회차로 replace 등)은 막지 않고 그대로 보낸다', async () => {
    getStatus.mockResolvedValue(status({ job: { id: 'j1', status: 'pending' } }));
    await render(<CoachScreen />);
    expect(await screen.findByText(QUEUED)).toBeOnTheScreen();

    const preventRemove = jest.requireMock('@react-navigation/native').usePreventRemove as jest.Mock;
    const leave = preventRemove.mock.calls.filter(([on]) => on).at(-1)[1];
    const action = { type: 'REPLACE', payload: { name: 'coach' } };
    await act(async () => leave({ data: { action } }));
    expect(mockNavDispatch).toHaveBeenCalledWith({ type: 'REPLACE', payload: { name: 'coach' } });
    expect(mockRouter.dismissTo).not.toHaveBeenCalledWith('/coaching');
  });

  test('작업이 돌기 시작하면 단계 문구로 바뀌고, 영상·장면 보기를 펼치면 기기에 있는 영상을 튼다', async () => {
    await render(<CoachScreen />);

    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
    expect(screen.queryByText(QUEUED)).not.toBeOnTheScreen();
    await waitFor(() => expect(localCopyFor).toHaveBeenCalledWith('v1'));

    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' }));
    expect(useVideoPlayer).toHaveBeenLastCalledWith('file:///local/v1.mp4', expect.any(Function));
    expect(screen.getByRole('button', { name: '영상과 장면 보기 접기' })).toBeOnTheScreen();
    expect(logged('video_fold_open')).toEqual([{ screen: 'analyzing' }]);
  });

  test('기기 복사본이 없거나 지워진 영상이면 서버 재생 주소로, 그것도 없으면 영상 없음으로 보인다', async () => {
    (localCopyFor as jest.Mock).mockRejectedValue(new Error('gone'));
    const view = await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);
    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' }));
    await waitFor(() => expect(useVideoPlayer).toHaveBeenLastCalledWith('https://play/v1', expect.any(Function)));
    await view.unmount();

    getPracticeApi.mockResolvedValue(detail({ video_purged: true, playback_url: null }));
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' }));
    expect(await screen.findByText('다시 볼 수 있는 영상이 없어요.')).toBeOnTheScreen();
  });

  test('기다리는 동안 장면 요약·묶음 제목은 보이지 않고 묶음도 따로 읽지 않는다', async () => {
    await render(<CoachScreen />);
    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1'));
    expect(screen.queryByText('분석에 쓰는 내용')).not.toBeOnTheScreen();
    expect(screen.queryByText('이별을 말하는 장면')).not.toBeOnTheScreen();
    expect(screen.queryByText('연습 제목')).not.toBeOnTheScreen();
    expect(api.getPracticeGroup).not.toHaveBeenCalled();
  });

  test('회차 내용을 못 읽어도 대기 화면은 그대로 둔다', async () => {
    getPracticeApi.mockRejectedValue(new Error('down'));
    await render(<CoachScreen />);

    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1'));
    expect(screen.queryByText('분석에 쓰는 내용')).not.toBeOnTheScreen();
    expect(screen.queryByText('분석이 잘 안 됐어요')).not.toBeOnTheScreen();
  });

  test('로그인 정보가 없으면 복구 기록을 남기지 않는다', async () => {
    mockUser = null;
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1'));
    expect(await pendingKeys()).toEqual([]);
  });

  test('회차 id 없이 들어오면 업로드 화면으로 돌려보내고 상태를 읽지 않는다', async () => {
    mockParams = { practiceId: ['p1', 'p2'] };
    await render(<CoachScreen />);

    expect(mockRouter.replace).toHaveBeenCalledWith('/upload');
    expect(getStatus).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('그만두기'));
    expect(screen.queryByText('분석을 그만둘까요?')).not.toBeOnTheScreen();
  });

  test('시간이 지나면 경과 시간과 단계 문구가 넘어가고 4초마다 다시 읽는다', async () => {
    jest.useFakeTimers();
    await render(<CoachScreen />);
    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
    expect(getStatus).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(4_000));
    expect(getStatus).toHaveBeenCalledTimes(2);

    await act(async () => jest.advanceTimersByTime(17_000));
    expect(screen.getByText('21초 경과')).toBeOnTheScreen();
    expect(screen.getByText(STAGES[1])).toBeOnTheScreen();

    await act(async () => jest.advanceTimersByTime(100_000));
    expect(screen.getByText('2분 1초 경과')).toBeOnTheScreen();
    expect(screen.getByText(STAGES[3])).toBeOnTheScreen();
  });
});

describe('분석이 끝나면', () => {
  test('회차를 들고 액티 화면으로 넘어가고 복구 기록을 지운다', async () => {
    getStatus.mockResolvedValue(READY);
    await render(<CoachScreen />);

    await entersCoach();
    expect(getPractice()).toEqual({
      practiceId: 'p1',
      rootId: 'r1',
      ordinal: 2,
      conversationId: 'c1',
      scene: { situation: '이별을 말하는 장면', character: '서연', goal: '담담하게' },
      videoUri: 'file:///local/v1.mp4',
      playbackUrl: 'https://play/v1',
      note: null,
    });
    expect(getPracticeApi).toHaveBeenCalledWith('p1', { signal: expect.any(AbortSignal) });
    expect(logged('analysis_complete')).toEqual([{ analysis: 'ready' }]);
    expect(await pendingKeys()).toEqual([]);
  });

  test('영상 없이 만든 회차를 다시 열어도 분석 완료로 집계하지 않는다', async () => {
    getStatus.mockResolvedValue(status({ stage: 'conversing', analysis_status: null, job: null }));
    getPracticeApi.mockResolvedValue({
      ...(await getPracticeApi()), video_id: null, playback_url: null,
    });
    await render(<CoachScreen />);
    await entersCoach();
    expect(logged('analysis_complete')).toEqual([]);
    expect(getPractice()?.videoUri).toBe('');
  });

  test('못 본 구간이 있으면 알리고, 확인을 누른 뒤에 넘어간다', async () => {
    getStatus.mockResolvedValue(status({ stage: 'conversing', analysis_status: 'partial' }));
    await render(<CoachScreen />);

    expect(await screen.findByText('일부 구간은 보지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText('본 만큼으로 이야기를 시작할게요.')).toBeOnTheScreen();
    staysWaiting();

    await fireEvent.press(screen.getByText('확인'));
    await entersCoach();
    expect(logged('analysis_complete')).toEqual([{ analysis: 'partial' }]);
  });

  test('회차 응답에 빈 값이 있으면 기본값으로 채워 넘긴다', async () => {
    getStatus.mockResolvedValue(READY);
    getPracticeApi.mockResolvedValue({
      ...detail({ video_id: null, playback_url: undefined, conversation_id: null }),
      root_id: null,
      ordinal: null,
      scene: { situation: null, character: null, goal: null },
    });
    await render(<CoachScreen />);

    await entersCoach();
    expect(getPractice()).toEqual({
      practiceId: 'p1',
      rootId: 'p1',
      ordinal: 1,
      // 대화 없이 넘겼고, 같은 화면이 바로 대화를 열어 붙였다.
      conversationId: 'c1',
      scene: { situation: '', character: '', goal: '' },
      videoUri: '',
      playbackUrl: null,
      note: null,
    });
    expect(localCopyFor).not.toHaveBeenCalled();
  });

  test('복구 기록을 남기지 못했어도 액티로 넘어간다', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    getStatus.mockResolvedValue(READY);
    await render(<CoachScreen />);

    await entersCoach();
    expect(getPractice()?.practiceId).toBe('p1');
    expect(await pendingKeys()).toEqual([]);
  });

  test('끝난 회차를 다시 못 읽으면 진행 상태를 못 읽었다고 알린다', async () => {
    getStatus.mockResolvedValue(READY);
    getPracticeApi.mockImplementation((_id: string, options?: { signal?: AbortSignal }) =>
      options?.signal ? Promise.reject(new Error('down')) : Promise.resolve(detail()),
    );
    await render(<CoachScreen />);

    expect(await screen.findByText(STATUS_UNAVAILABLE, { exact: false })).toBeOnTheScreen();
    staysWaiting();
  });

  test('액티로 넘어간 뒤 앱이 다시 활성화돼도 다시 읽지 않는다', async () => {
    getStatus.mockResolvedValue(READY);
    await render(<CoachScreen />);
    await entersCoach();

    await act(async () => appStateListener?.('active'));
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});

describe('다시 읽는 때', () => {
  test('앱이 다시 활성화되면 다음 조회를 기다리지 않고 바로 읽는다', async () => {
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);
    expect(getStatus).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener?.('background'));
    expect(getStatus).toHaveBeenCalledTimes(1);

    getStatus.mockResolvedValue(READY);
    await act(async () => appStateListener?.('active'));
    await entersCoach();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  test('이 회차의 완료 푸시가 오면 바로 읽고, 다른 회차의 푸시는 넘긴다', async () => {
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await act(async () => mockPushListener?.({ kind: 'analysis_complete', practice_id: 'p-other' }));
    expect(getStatus).toHaveBeenCalledTimes(1);

    getStatus.mockResolvedValue(READY);
    await act(async () => mockPushListener?.({ kind: 'analysis_complete', practice_id: 'p1' }));
    await entersCoach();
  });

  test('화면을 떠나면 조회를 멈추고 오류도 남기지 않는다', async () => {
    jest.useFakeTimers();
    await render(<CoachScreen />);
    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();

    await act(async () => mockBlur());
    await act(async () => jest.advanceTimersByTimeAsync(12_000));

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('분석이 잘 안 됐어요')).not.toBeOnTheScreen();
  });

  test('화면에 돌아오면 서버 상태부터 다시 읽는다', async () => {
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    getStatus.mockResolvedValue(FAILED('parse'));
    await act(async () => {
      mockFocusEffect();
    });
    expect(await screen.findByText('분석 결과를 정리하지 못했어요. 다시 시도해 주세요.', { exact: false })).toBeOnTheScreen();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  test('끝난 회차를 읽는 사이 다른 조회가 시작되면 앞의 것은 오류도 이동도 남기지 않는다', async () => {
    getStatus.mockResolvedValueOnce(READY).mockImplementation(never);
    let rejectLoad: (e: Error) => void = () => undefined;
    getPracticeApi.mockImplementation((_id: string, options?: { signal?: AbortSignal }) =>
      options?.signal
        ? new Promise((_resolve, reject) => {
            rejectLoad = reject;
          })
        : Promise.resolve(detail()),
    );
    await render(<CoachScreen />);
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1', { signal: expect.any(AbortSignal) }));

    await act(async () => appStateListener?.('active'));
    await act(async () => rejectLoad(new Error('aborted')));

    expect(screen.queryByText(STATUS_UNAVAILABLE)).not.toBeOnTheScreen();
    staysWaiting();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  test('못 본 구간 안내를 보는 사이 다른 조회가 시작되면 확인을 눌러도 넘어가지 않는다', async () => {
    getStatus.mockResolvedValueOnce(status({ stage: 'conversing', analysis_status: 'partial' })).mockImplementation(never);
    await render(<CoachScreen />);
    await screen.findByText('본 만큼으로 이야기를 시작할게요.');

    await act(async () => appStateListener?.('active'));
    await fireEvent.press(screen.getByText('확인'));

    staysWaiting();
    expect(logged('analysis_complete')).toEqual([]);
  });
});

describe('분석이 실패하면', () => {
  test.each([
    ['timeout', '분석 시간이 초과됐어요. 영상을 더 짧게 잘라서 다시 시도해 주세요.'],
    ['unsupported', '지원하지 않는 영상 형식이에요. mp4로 다시 올려 주세요.'],
    ['max_attempts', '분석에 실패했어요. 다시 시도해 주세요.'],
  ])('%s 이면 사유와 다시 시도 버튼을 보인다', async (reason, message) => {
    getStatus.mockResolvedValue(FAILED(reason));
    await render(<CoachScreen />);

    expect(await screen.findByText(`${message} 영상은 그대로 있으니 「다시 시도」를 누르세요.`)).toBeOnTheScreen();
    expect(screen.getByText('분석이 잘 안 됐어요')).toBeOnTheScreen();
    expect(screen.queryByText(WATCHING)).not.toBeOnTheScreen();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
    expect(logged('analysis_failed')).toEqual([{ reason }]);
  });

  test('취소로 끝난 회차는 다시 시도할 수 없고 기록에서 보라고 안내한다', async () => {
    getStatus.mockResolvedValue(status({ stage: 'closed', close_reason: 'cancelled', job: null }));
    await render(<CoachScreen />);

    expect(await screen.findByText('분석을 그만뒀어요. 영상은 그대로 있어요.', { exact: false })).toBeOnTheScreen();
    expect(screen.queryByText('영상은 그대로 있으니 「다시 시도」를 누르세요.', { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText('다시 시도')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByText('나중에 기록에서 보기'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)');
  });

  test('사유 없이 닫히면 unknown 으로 세고, 다시 시도는 새 분석 없이 상태만 다시 읽는다', async () => {
    getStatus.mockResolvedValue(status({ stage: 'closed', job: null }));
    await render(<CoachScreen />);
    expect(await screen.findByText('분석에 실패했어요. 다시 시도해 주세요.', { exact: false })).toBeOnTheScreen();
    expect(logged('analysis_failed')).toEqual([{ reason: 'unknown' }]);

    getStatus.mockResolvedValue(READY);
    await fireEvent.press(screen.getByText('다시 시도'));
    await entersCoach();
    expect(api.retryPracticeAnalysis).not.toHaveBeenCalled();
  });

  test('조회가 세 번 연달아 실패하면 진행 상태를 못 읽었다고 알린다', async () => {
    jest.useFakeTimers();
    getStatus.mockRejectedValue(new Error('down'));
    await render(<CoachScreen />);

    await act(async () => jest.advanceTimersByTimeAsync(8_000));
    expect(screen.getByText(STATUS_UNAVAILABLE, { exact: false })).toBeOnTheScreen();
    expect(getStatus).toHaveBeenCalledTimes(3);
  });
});

describe('다시 시도', () => {
  async function renderFailed() {
    getStatus.mockResolvedValue(FAILED('timeout'));
    await render(<CoachScreen />);
    await screen.findByText('다시 시도');
  }

  test('새 작업을 만들고 다시 기다린다', async () => {
    (api.retryPracticeAnalysis as jest.Mock).mockResolvedValue(undefined);
    await renderFailed();

    getStatus.mockResolvedValue(status());
    await fireEvent.press(screen.getByText('다시 시도'));

    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
    expect(api.retryPracticeAnalysis).toHaveBeenCalledWith('p1', { requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  test('요청 중에는 버튼 글자 대신 진행 표시를 보인다', async () => {
    let resolveRetry: () => void = () => undefined;
    (api.retryPracticeAnalysis as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    await renderFailed();

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(screen.queryByText('다시 시도')).not.toBeOnTheScreen();

    getStatus.mockResolvedValue(status());
    await act(async () => resolveRetry());
    expect(await screen.findByText(STAGES[0])).toBeOnTheScreen();
  });

  test.each([
    ['guest_daily_analysis_limit', '오늘 분석을 다 썼어요. 내일 다시 할 수 있어요.'],
    ['request_fingerprint_mismatch', '요청 내용이 바뀌었어요. 다시 보내 주세요.'],
    ['internal_error', '다시 시도하지 못했어요. 잠시 뒤에 해 주세요.'],
  ])('서버가 %s 로 거절하면 그 사유를 보인다', async (code, message) => {
    (api.retryPracticeAnalysis as jest.Mock).mockRejectedValue(serverError(code === 'internal_error' ? 500 : 409, code));
    await renderFailed();

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText(message, { exact: false })).toBeOnTheScreen();
  });

  test('코드 없는 실패면 다시 누를 때 같은 요청 id 를, 요청이 바뀌었다는 거절 뒤에는 새 id 를 쓴다', async () => {
    const retry = api.retryPracticeAnalysis as jest.Mock;
    retry.mockRejectedValueOnce('network down');
    await renderFailed();

    await fireEvent.press(screen.getByText('다시 시도'));
    await screen.findByText('다시 시도하지 못했어요. 잠시 뒤에 해 주세요.', { exact: false });
    retry.mockRejectedValueOnce(serverError(409, 'request_fingerprint_mismatch'));
    await fireEvent.press(screen.getByText('다시 시도'));
    await screen.findByText('요청 내용이 바뀌었어요. 다시 보내 주세요.', { exact: false });
    retry.mockRejectedValueOnce(serverError(500, 'internal_error'));
    await fireEvent.press(screen.getByText('다시 시도'));
    await screen.findByText('다시 시도하지 못했어요. 잠시 뒤에 해 주세요.', { exact: false });

    const ids = retry.mock.calls.map(([, options]) => options.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  test('이미 실패 상태가 아니라고 하면 새 작업 없이 상태를 다시 읽는다', async () => {
    (api.retryPracticeAnalysis as jest.Mock).mockRejectedValue(serverError(409, 'analysis_not_failed'));
    await renderFailed();

    getStatus.mockResolvedValue(READY);
    await fireEvent.press(screen.getByText('다시 시도'));
    await entersCoach();
  });

  test('같은 묶음에 진행 중인 회차가 있으면 그 회차의 분석 화면으로 옮긴다', async () => {
    (api.retryPracticeAnalysis as jest.Mock).mockRejectedValue(serverError(409, 'practice_in_progress'));
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({
      groups: [
        { root_id: 'r-other', in_progress_practice_id: 'p-x' },
        { root_id: 'r1', in_progress_practice_id: 'p9' },
      ],
    });
    await renderFailed();
    await waitFor(() => expect(getPracticeApi).toHaveBeenCalledWith('p1'));

    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p9' } }),
    );
  });

  test('진행 중인 회차를 못 찾거나 목록을 못 읽으면 먼저 마치라고 안내한다', async () => {
    const inProgressBody = '먼저 하던 연습을 마치거나 그만둔 뒤에 새 연습을 시작할 수 있어요.';
    (api.retryPracticeAnalysis as jest.Mock).mockRejectedValue(serverError(409, 'practice_in_progress'));
    (api.listPracticeGroups as jest.Mock).mockResolvedValue({ groups: [{ root_id: 'r1', in_progress_practice_id: null }] });
    getPracticeApi.mockRejectedValue(new Error('down'));
    await renderFailed();

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText(inProgressBody, { exact: false })).toBeOnTheScreen();
    expect(api.listPracticeGroups).toHaveBeenCalledTimes(1);

    (api.listPracticeGroups as jest.Mock).mockRejectedValue(new Error('down'));
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(api.listPracticeGroups).toHaveBeenCalledTimes(2));
    expect(screen.getByText(inProgressBody, { exact: false })).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/coach' }));
  });
});

describe('그만두기', () => {
  test('확인 창에서 계속 기다리기를 고르면 아무것도 취소하지 않는다', async () => {
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await fireEvent.press(screen.getByText('그만두기'));
    expect(screen.getByText('분석을 그만둘까요?')).toBeOnTheScreen();
    expect(
      screen.getByText('이번 회차는 여기서 닫혀요. 영상은 그대로 있어서 다시 시작할 수 있어요.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('계속 기다리기'));

    expect(screen.queryByText('분석을 그만둘까요?')).not.toBeOnTheScreen();
    expect(api.cancelPractice).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('그만두면 작업을 취소하고 복구 기록을 지운 뒤 홈으로 간다', async () => {
    let resolveCancel: () => void = () => undefined;
    (api.cancelPractice as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);
    await waitFor(async () => expect(await pendingKeys()).toEqual([PENDING_KEY]));

    await fireEvent.press(screen.getByText('그만두기'));
    await fireEvent.press(screen.getAllByText('그만두기')[1]);
    expect(await screen.findByText('정리하는 중…')).toBeOnTheScreen();
    expect(api.cancelPractice).toHaveBeenCalledWith('p1');

    await fireEvent.press(screen.getByText('정리하는 중…'));
    expect(api.cancelPractice).toHaveBeenCalledTimes(1);

    await act(async () => resolveCancel());
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)'));
    expect(logged('analysis_cancelled')).toEqual([{}]);
    expect(await pendingKeys()).toEqual([]);
  });

  test('이미 끝난 작업이라 서버가 409 를 주면 그대로 홈으로 간다', async () => {
    (api.cancelPractice as jest.Mock).mockRejectedValue(serverError(409, 'analysis_already_finished'));
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await fireEvent.press(screen.getByText('그만두기'));
    await fireEvent.press(screen.getAllByText('그만두기')[1]);
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)'));
  });

  test('복구 기록이 없어도 그만두면 홈으로 간다', async () => {
    mockUser = null;
    (api.cancelPractice as jest.Mock).mockResolvedValue(undefined);
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await fireEvent.press(screen.getByText('그만두기'));
    await fireEvent.press(screen.getAllByText('그만두기')[1]);
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)'));
    expect(api.cancelPractice).toHaveBeenCalledWith('p1');
  });

  test('취소가 실패하면 그만두지 못했다고 알린다', async () => {
    (api.cancelPractice as jest.Mock).mockRejectedValue(serverError(500, 'internal_error'));
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await fireEvent.press(screen.getByText('그만두기'));
    await fireEvent.press(screen.getAllByText('그만두기')[1]);

    expect(await screen.findByText('그만두지 못했어요. 잠시 뒤에 다시 해 주세요.', { exact: false })).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('취소하는 사이 시작된 조회가 끝남을 받아도 액티로 가지 않는다', async () => {
    let resolveCancel: () => void = () => undefined;
    (api.cancelPractice as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    let resolveStatus: (s: PracticeStatus) => void = () => undefined;
    await render(<CoachScreen />);
    await screen.findByText(STAGES[0]);

    await fireEvent.press(screen.getByText('그만두기'));
    await fireEvent.press(screen.getAllByText('그만두기')[1]);
    getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    await act(async () => appStateListener?.('active'));
    await act(async () => resolveCancel());
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)'));

    await act(async () => resolveStatus(READY));
    staysWaiting();
    expect(getPractice()).toBeNull();
  });
});

describe('튜토리얼 예시', () => {
  beforeEach(() => {
    mockParams = { practiceId: SAMPLE_PRACTICE_ID };
  });

  test('서버 없이 단계 문구를 넘긴 뒤 예시 회차를 들고 액티로 간다', async () => {
    jest.useFakeTimers();
    await render(<CoachScreen />);

    expect(screen.getByText(STAGES[0])).toBeOnTheScreen();
    expect(screen.getByText('예시 영상이라 금방 끝나요. 실제 연습은 보통 30초쯤 걸려요.')).toBeOnTheScreen();
    // 예시도 장면 요약은 대기 화면에 두지 않고, 「끝나면 알려 주세요」로 나가는 길도 없다.
    expect(screen.queryByText('카페에서 오래 만난 연인에게 헤어지자는 말을 꺼내는 장면')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '끝나면 알려 주세요' })).not.toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1_200));
    expect(screen.getByText(STAGES[1])).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1_400));
    expect(screen.getByText(STAGES[2])).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(1_200));
    expect(screen.queryByText(WATCHING)).not.toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(getPractice()).toMatchObject({
      practiceId: SAMPLE_PRACTICE_ID,
      rootId: SAMPLE_PRACTICE_ID,
      ordinal: 1,
      scene: {
        situation: '카페에서 오래 만난 연인에게 헤어지자는 말을 꺼내는 장면',
        character: '말을 꺼내기 전까지 몇 번이나 망설인 서연',
        goal: '담담하게 말하지만 아직 미련이 남아 있다는 게 보이게',
      },
      videoUri: 'file:///sample.mp4',
      playbackUrl: null,
      note: null,
    });
    expect(getStatus).not.toHaveBeenCalled();
    expect(getPracticeApi).not.toHaveBeenCalled();
    expect(await pendingKeys()).toEqual([]);
  });

  test('튜토리얼 설명을 다 보기 전에는 넘어가지 않는다', async () => {
    jest.useFakeTimers();
    startTutorial('sample');
    await render(<CoachScreen />);

    await act(async () => jest.advanceTimersByTimeAsync(5_000));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(currentSpotlight()?.steps).toEqual([{ target: 'analyzing.progress', text: 'tutorial.anSample' }]);

    expect(screen.getByText(WATCHING)).toBeOnTheScreen();

    await act(async () => currentSpotlight()?.onDone('done'));
    expect(getPractice()?.practiceId).toBe(SAMPLE_PRACTICE_ID);
    expect(screen.queryByText(WATCHING)).not.toBeOnTheScreen();
  });

  test('도중에 화면을 떠나면 액티로 넘기지 않는다', async () => {
    jest.useFakeTimers();
    const view = await render(<CoachScreen />);
    await act(async () => jest.advanceTimersByTime(1_200));
    await view.unmount();

    await act(async () => jest.advanceTimersByTime(5_000));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(getPractice()).toBeNull();
  });

  test('그만두기는 확인 없이 튜토리얼을 나감으로 끝내고 홈으로 간다', async () => {
    startTutorial('sample');
    await render(<CoachScreen />);

    await fireEvent.press(screen.getByText('그만두기'));

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)');
    expect(screen.queryByText('분석을 그만둘까요?')).not.toBeOnTheScreen();
    expect(currentTutorial()).toBeNull();
    expect(logged('tutorial_finish')).toEqual([{ mode: 'sample', track: 'practice', how: 'left' }]);
  });
});

test('개발용 미리보기는 서버 없이 예시 회차를 보인다', async () => {
  mockParams = { preview: '1' };
  await render(<CoachScreen />);

  expect(screen.getByText(WATCHING)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '영상과 장면 보기 펼치기' })).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(getStatus).not.toHaveBeenCalled();
  expect(getPracticeApi).not.toHaveBeenCalled();
  expect(mockPushListener).toBeNull();
});
