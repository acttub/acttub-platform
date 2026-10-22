import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import PracticeGroupScreen from '@/app/practice-group';
import { api } from '@/lib/api';
import { hasSeenSpotlight, markSpotlightSeen } from '@/lib/guide-state';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { CoachConversation, PracticeGroupDetail, PracticeRound } from '@/lib/practice/types';

const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
let mockParams: { rootId?: string } = {};
jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  return {
    Stack: {
      Screen: ({ options }: { options: { title: string; headerRight: () => unknown } }) => (
        <View testID="header">
          <Text>{options.title}</Text>
          {options.headerRight() as never}
        </View>
      ),
    },
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/api', () => ({
  api: { getPracticeGroup: jest.fn(), getConversation: jest.fn(), patchPracticeGroup: jest.fn() },
}));
jest.mock('@/lib/practice/session-state', () => ({ setContinueOrigin: jest.fn() }));
jest.mock('@/lib/guide-state', () => ({ hasSeenSpotlight: jest.fn(), markSpotlightSeen: jest.fn() }));
jest.mock('@/hooks/use-spotlight-target', () => ({ useSpotlightTarget: () => ({ ref: undefined, onLayout: undefined }) }));
jest.mock('@/components/spotlight-guide', () => {
  const { Pressable, Text } = require('react-native');
  return {
    SpotlightGuide: ({ visible, steps, onDone }: { visible: boolean; steps: { text: string }[]; onDone: () => void }) =>
      visible ? (
        <Pressable accessibilityRole="button" onPress={onDone}>
          <Text>{steps.map((s) => s.text).join(',')}</Text>
        </Pressable>
      ) : null,
  };
});

const getGroup = api.getPracticeGroup as jest.Mock;
const getConversation = api.getConversation as jest.Mock;
const patchGroup = api.patchPracticeGroup as jest.Mock;

function round(overrides: Partial<PracticeRound>): PracticeRound {
  return {
    id: 'p1',
    ordinal: 1,
    created_at: '2026-03-05T03:00:00Z',
    stage: 'closed' as PracticeRound['stage'],
    message_count: 4,
    note: null,
    conversation_id: null,
    previous_conversations: [],
    ...overrides,
  };
}

function group(overrides: Partial<PracticeGroupDetail> = {}): PracticeGroupDetail {
  return {
    root_id: 'root1',
    title: '이별 통보 장면',
    ordinal_count: 2,
    in_progress_practice_id: null,
    favorite: false,
    hidden_at: null,
    video_id: 'v1',
    last_conversation_id: 'conv-last',
    practices: [
      round({ id: 'p1', ordinal: 1, note: { id: 'n1', title: '첫 숨', kind: 'action' }, conversation_id: 'conv-1' }),
      round({
        id: 'p2',
        ordinal: 2,
        message_count: 0,
        created_at: '2026-03-06T03:00:00Z',
        previous_conversations: [{ id: 'conv-old', status: 'closed' as never, created_at: '2026-03-06T01:00:00Z' }],
      }),
    ],
    ...overrides,
  };
}

function conversation(messages: [number, 'coach' | 'actor', string][]): CoachConversation {
  return {
    id: 'c',
    practice_id: null,
    status: 'closed' as never,
    close_reason: null,
    created_at: null,
    revision: 1,
    coach_reply_count: 1,
    reply_limit: 8,
    messages: messages.map(([turn_index, role, text]) => ({ turn_index, role, text, created_at: null })),
  };
}

const header = () => within(screen.getByTestId('header'));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { rootId: 'root1' };
  getGroup.mockResolvedValue(group());
  (hasSeenSpotlight as jest.Mock).mockResolvedValue(true);
});

test('묶음 제목·회차 흐름·노트 보기를 보여 준다', async () => {
  await render(<PracticeGroupScreen />);

  expect(await screen.findByText('2회')).toBeOnTheScreen();
  expect(getGroup).toHaveBeenCalledWith('root1');
  expect(header().getByText('이별 통보 장면')).toBeOnTheScreen();
  expect(screen.getByText('1차 · 대화 4개 · 첫 숨')).toBeOnTheScreen();
  expect(screen.getByText('2차 · 대화 0개 · 아직 정리 없음')).toBeOnTheScreen();
  expect(screen.getByText('3월 5일')).toBeOnTheScreen();
  expect(screen.getByText('이전 대화 · 3월 6일')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: /노트 보기/ }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/report-detail', params: { practiceId: 'p1' } });

  expect(screen.queryByRole('button', { name: '연습 영상 보기' })).not.toBeOnTheScreen();
});

test('대화를 누르면 순서대로 펼치고, 못 읽으면 다시 누르라고 한다', async () => {
  getConversation
    .mockResolvedValueOnce(conversation([[2, 'coach', '어땠어요?'], [1, 'actor', '긴장했어요']]))
    .mockRejectedValueOnce(new Error('down'));
  await render(<PracticeGroupScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '마지막 대화' }));
  expect(getConversation).toHaveBeenCalledWith('conv-last');
  expect(screen.getAllByText(/^(긴장했어요|어땠어요\?)$/).map((n) => n.props.children)).toEqual(['긴장했어요', '어땠어요?']);
  expect(screen.getByText('나')).toBeOnTheScreen();
  expect(screen.getByText('코치')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '이전 대화 · 3월 6일' }));
  expect(getConversation).toHaveBeenLastCalledWith('conv-old');
  expect(await screen.findByText('대화를 불러오지 못했어요. 다시 눌러 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('긴장했어요')).not.toBeOnTheScreen();
});

test('먼저 누른 대화가 늦게 오면 버린다', async () => {
  let resolveFirst!: (v: CoachConversation) => void;
  let rejectSecond!: (e: unknown) => void;
  getConversation
    .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
    .mockReturnValueOnce(new Promise((_, j) => (rejectSecond = j)))
    .mockResolvedValueOnce(conversation([[1, 'coach', '세 번째']]));
  await render(<PracticeGroupScreen />);
  await screen.findByText('2회');

  await fireEvent.press(screen.getByRole('button', { name: '마지막 대화' }));
  await fireEvent.press(screen.getByRole('button', { name: '대화' }));
  await fireEvent.press(screen.getByRole('button', { name: '이전 대화 · 3월 6일' }));
  expect(await screen.findByText('세 번째')).toBeOnTheScreen();

  await act(async () => {
    resolveFirst(conversation([[1, 'coach', '첫 번째']]));
    rejectSecond(new Error('late'));
  });
  expect(screen.queryByText('첫 번째')).not.toBeOnTheScreen();
  expect(screen.queryByText('대화를 불러오지 못했어요. 다시 눌러 주세요.')).not.toBeOnTheScreen();
});

test('열린 테이크가 없으면 다음 테이크를 마지막 회차에 이어 만든다', async () => {
  await render(<PracticeGroupScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '다음 테이크 찍기' }));

  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'root1', practiceId: 'p2' });
  expect(mockRouter.push).toHaveBeenCalledWith('/upload');
});

test('회차가 없으면 묶음 id로 다음 테이크를 만든다', async () => {
  getGroup.mockResolvedValue(group({ practices: [], video_id: null, last_conversation_id: null, title: null, situation: '옥상 장면' }));
  await render(<PracticeGroupScreen />);

  expect(await screen.findAllByText('옥상 장면')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '연습 영상 보기' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다음 테이크 찍기' }));
  expect(setContinueOrigin).toHaveBeenCalledWith({ kind: 'group', rootId: 'root1', practiceId: 'root1' });
});

test('대화 중인 테이크가 있으면 맨 위에서 그 대화로 돌아간다', async () => {
  getGroup.mockResolvedValue(group({ in_progress_practice_id: 'p2' }));
  await render(<PracticeGroupScreen />);

  await fireEvent.press(await screen.findByRole('button', { name: '대화 이어 가기' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/coach', params: { practiceId: 'p2' } });
  expect(screen.queryByRole('button', { name: '다음 테이크 찍기' })).not.toBeOnTheScreen();
  expect(hasSeenSpotlight).not.toHaveBeenCalled();
});

describe('삭제(숨김)', () => {
  test('확인하면 숨기고 다시 보이기로 바꾼다', async () => {
    patchGroup.mockResolvedValue(group({ hidden_at: '2026-10-20T00:00:00Z' }));
    await render(<PracticeGroupScreen />);

    await fireEvent.press(await screen.findByText('삭제'));
    expect(await screen.findByText('이 연습을 기록에서 삭제할까요?')).toBeOnTheScreen();
    const labels = screen.getAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);

    expect(patchGroup).toHaveBeenCalledWith('root1', { hidden: true });
    expect(await screen.findByText('다시 보이기')).toBeOnTheScreen();
    expect(header().queryByRole('button')).not.toBeOnTheScreen();
  });

  test('다시 보이기는 묻지 않고 되돌린다', async () => {
    getGroup.mockResolvedValue(group({ hidden_at: '2026-10-20T00:00:00Z' }));
    patchGroup.mockResolvedValue(group());
    await render(<PracticeGroupScreen />);

    await fireEvent.press(await screen.findByText('다시 보이기'));
    expect(patchGroup).toHaveBeenCalledWith('root1', { hidden: false });
    expect(await screen.findByText('삭제')).toBeOnTheScreen();
  });

  test('머리의 삭제는 숨긴 뒤 목록으로 돌아간다', async () => {
    mockRouter.canGoBack.mockReturnValue(true);
    patchGroup.mockResolvedValue(group({ hidden_at: '2026-10-20T00:00:00Z' }));
    await render(<PracticeGroupScreen />);
    await screen.findByText('2회');

    await fireEvent.press(header().getByRole('button', { name: '삭제' }));
    const labels = await screen.findAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);

    expect(patchGroup).toHaveBeenCalledWith('root1', { hidden: true });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('돌아갈 곳이 없으면 머리의 삭제도 화면에 남는다', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    patchGroup.mockResolvedValue(group({ hidden_at: '2026-10-20T00:00:00Z' }));
    await render(<PracticeGroupScreen />);
    await screen.findByText('2회');

    await fireEvent.press(header().getByRole('button', { name: '삭제' }));
    const labels = await screen.findAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);

    expect(await screen.findByText('다시 보이기')).toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('취소하면 보내지 않는다', async () => {
    await render(<PracticeGroupScreen />);
    await fireEvent.press(await screen.findByText('삭제'));
    await fireEvent.press(await screen.findByText('취소'));
    expect(patchGroup).not.toHaveBeenCalled();
    expect(screen.getByText('삭제')).toBeOnTheScreen();
  });

  test.each([
    [new Error('권한 없음'), '권한 없음'],
    ['boom', '삭제하지 못했어요.'],
  ])('실패하면 이유를 알린다 (%#)', async (cause, message) => {
    patchGroup.mockRejectedValue(cause);
    await render(<PracticeGroupScreen />);
    await fireEvent.press(await screen.findByText('삭제'));
    const labels = await screen.findAllByText('삭제');
    await fireEvent.press(labels[labels.length - 1]);

    expect(await screen.findByText('삭제 실패')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
  });
});

test('못 불러오면 그렇다고 알리고 머리 제목은 연습 기록이다', async () => {
  getGroup.mockRejectedValue(new Error('down'));
  await render(<PracticeGroupScreen />);

  expect(await screen.findByText('연습 기록을 불러오지 못했어요.')).toBeOnTheScreen();
  expect(header().getByText('연습 기록')).toBeOnTheScreen();
});

test('묶음 id 없이 열면 읽지 않는다', async () => {
  mockParams = {};
  await render(<PracticeGroupScreen />);
  expect(getGroup).not.toHaveBeenCalled();
  expect(header().getByText('연습 기록')).toBeOnTheScreen();
});

describe('처음 한 번 비추는 안내', () => {
  test('본 적이 없으면 잠시 뒤 다음 테이크 버튼을 비추고, 닫으면 본 것으로 남긴다', async () => {
    jest.useFakeTimers();
    try {
      (hasSeenSpotlight as jest.Mock).mockResolvedValue(false);
      await render(<PracticeGroupScreen />);
      await screen.findByText('2회');
      expect(hasSeenSpotlight).toHaveBeenCalledWith('group');
      expect(screen.queryByText('guide.spotContinue')).not.toBeOnTheScreen();

      await act(() => jest.advanceTimersByTime(300));
      await fireEvent.press(screen.getByText('guide.spotContinue'));

      expect(markSpotlightSeen).toHaveBeenCalledWith('group');
      expect(screen.queryByText('guide.spotContinue')).not.toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
});
