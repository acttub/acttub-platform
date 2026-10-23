import { act, fireEvent, render, screen } from '@testing-library/react-native';

import MemoryScreen from '@/app/memory';
import { api, type MemoryItem } from '@/lib/api';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: { from?: string } = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/api', () => ({
  api: {
    actorMemory: jest.fn(),
    saveActorMemory: jest.fn(),
    deleteActorMemory: jest.fn(),
    deleteAllActorMemory: jest.fn(),
  },
}));

const actorMemory = api.actorMemory as jest.Mock;
const saveActorMemory = api.saveActorMemory as jest.Mock;
const deleteOne = api.deleteActorMemory as jest.Mock;
const deleteAll = api.deleteAllActorMemory as jest.Mock;

function item(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    field: 'goal',
    value: '입시 합격',
    written_by_actor: false,
    source_practice_id: null,
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const goal = item({ field: 'goal', value: '입시 합격', source_practice_id: 'p7' });
const self = item({ field: 'speech_self', value: '차분하게 말한다', written_by_actor: true, source_practice_id: 'p8' });

const saveButtons = () => screen.getAllByText(/^(저장|저장 중|저장됨)$/);
const input = (placeholder: string) => screen.getByPlaceholderText(placeholder);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  actorMemory.mockResolvedValue({ items: [goal, self] });
});

test('칸마다 누가 적었는지와 근거 연습 링크를 보여 준다', async () => {
  await render(<MemoryScreen />);

  expect(await screen.findByDisplayValue('입시 합격')).toBeOnTheScreen();
  expect(screen.getByText('← 설정')).toBeOnTheScreen();
  expect(screen.getByText('액티가 적음')).toBeOnTheScreen();
  expect(screen.getByText('내가 적은 값')).toBeOnTheScreen();
  expect(screen.getAllByText('비어 있음')).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: '이 말이 나온 연습 보기' })).toHaveLength(1);
  expect(screen.queryByText('아직 적힌 게 없어요')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '이 말이 나온 연습 보기' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/report-detail', params: { practiceId: 'p7' } });
});

test('프로필에서 왔으면 뒤로 글자가 프로필이다', async () => {
  mockParams = { from: 'profile' };
  await render(<MemoryScreen />);
  await fireEvent.press(await screen.findByText('← 프로필'));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('아무것도 없으면 빈 안내를 보이고 전부 지우기는 없다', async () => {
  actorMemory.mockResolvedValue({ items: [] });
  await render(<MemoryScreen />);

  expect(await screen.findByText('아직 적힌 게 없어요')).toBeOnTheScreen();
  expect(screen.queryByText('기억 전부 지우기')).not.toBeOnTheScreen();
  expect(saveButtons()).toHaveLength(4);
  for (const button of saveButtons()) expect(button).toBeDisabled();
});

test('못 불러와도 화면은 뜨고 그렇다고 알린다', async () => {
  actorMemory.mockRejectedValue(new Error('down'));
  await render(<MemoryScreen />);

  expect(await screen.findByText('잠시 후 다시 열어주세요.')).toBeOnTheScreen();
  expect(screen.getByText('아직 적힌 게 없어요')).toBeOnTheScreen();
});

test('고친 값만 저장할 수 있고, 저장하면 내가 적은 값이 된다', async () => {
  jest.useFakeTimers();
  try {
    saveActorMemory.mockResolvedValue(item({ field: 'blockage', value: '의도 잡기', written_by_actor: true }));
    await render(<MemoryScreen />);
    await screen.findByDisplayValue('입시 합격');

    const blockageSave = saveButtons()[1];
    expect(blockageSave).toBeDisabled();
    await fireEvent.changeText(input('예) 대사의 의도를 잡는 게 늘 어렵다'), '  의도 잡기 ');
    expect(saveButtons()[1]).toBeEnabled();
    await fireEvent.press(saveButtons()[1]);

    expect(saveActorMemory).toHaveBeenCalledWith('blockage', '의도 잡기');
    expect(screen.getByText('저장됨')).toBeOnTheScreen();
    expect(screen.getAllByText('내가 적은 값')).toHaveLength(2);

    await act(() => jest.advanceTimersByTime(1500));
    expect(screen.queryByText('저장됨')).not.toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test('저장하는 동안 그 칸의 버튼은 저장 중이다', async () => {
  let finish!: (v: MemoryItem) => void;
  saveActorMemory.mockReturnValue(new Promise((r) => (finish = r)));
  await render(<MemoryScreen />);
  await screen.findByDisplayValue('입시 합격');

  await fireEvent.changeText(input('예) 입시에서 자유연기로 합격하기'), '연극영화과 합격');
  await fireEvent.press(saveButtons()[0]);
  expect(screen.getByText('저장 중')).toBeDisabled();

  await act(async () => finish(item({ field: 'goal', value: '연극영화과 합격', written_by_actor: true })));
  expect(screen.queryByText('저장 중')).not.toBeOnTheScreen();
});

test('1,000자를 넘으면 저장하지 않고 알린다', async () => {
  await render(<MemoryScreen />);
  await screen.findByDisplayValue('입시 합격');

  await fireEvent.changeText(input('예) 문장 끝을 흐리며 빨라진다'), '가'.repeat(1001));
  await fireEvent.press(saveButtons()[3]);

  expect(await screen.findByText('기억은 1,000자까지 적을 수 있어요.')).toBeOnTheScreen();
  expect(saveActorMemory).not.toHaveBeenCalled();
});

test.each([
  [new Error('서버 점검 중'), '서버 점검 중'],
  ['boom', '잠시 후 다시 시도해주세요.'],
])('저장이 실패하면 이유를 알린다 (%#)', async (cause, message) => {
  saveActorMemory.mockRejectedValue(cause);
  await render(<MemoryScreen />);
  await screen.findByDisplayValue('입시 합격');

  await fireEvent.changeText(input('예) 입시에서 자유연기로 합격하기'), '새 목표');
  await fireEvent.press(saveButtons()[0]);

  expect(await screen.findByText('저장하지 못했어요')).toBeOnTheScreen();
  expect(screen.getByText(message)).toBeOnTheScreen();
});

describe('한 칸 지우기', () => {
  const pressRemoveGoal = async () => {
    await screen.findByDisplayValue('입시 합격');
    await fireEvent.press(screen.getAllByText('지우기')[0]);
    expect(await screen.findByText("'목표'을 지울까요?")).toBeOnTheScreen();
  };

  test('확인하면 지우고 비어 있음으로 돌린다', async () => {
    deleteOne.mockResolvedValue(undefined);
    await render(<MemoryScreen />);
    await pressRemoveGoal();
    const labels = screen.getAllByText('지우기');
    await fireEvent.press(labels[labels.length - 1]);

    expect(deleteOne).toHaveBeenCalledWith('goal');
    expect(screen.queryByDisplayValue('입시 합격')).not.toBeOnTheScreen();
    expect(screen.getAllByText('비어 있음')).toHaveLength(3);
  });

  test('취소하면 지우지 않는다', async () => {
    await render(<MemoryScreen />);
    await pressRemoveGoal();
    await fireEvent.press(screen.getByText('취소'));
    expect(deleteOne).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('입시 합격')).toBeOnTheScreen();
  });

  test.each([
    [new Error('없는 칸'), '없는 칸'],
    [42, '잠시 후 다시 시도해주세요.'],
  ])('실패하면 이유를 알린다 (%#)', async (cause, message) => {
    deleteOne.mockRejectedValue(cause);
    await render(<MemoryScreen />);
    await pressRemoveGoal();
    const labels = screen.getAllByText('지우기');
    await fireEvent.press(labels[labels.length - 1]);

    expect(await screen.findByText('지우지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
  });
});

describe('전부 지우기', () => {
  const pressRemoveAll = async () => {
    await fireEvent.press(await screen.findByText('기억 전부 지우기'));
    expect(await screen.findByText('기억을 전부 지울까요?')).toBeOnTheScreen();
  };

  test('확인하면 모두 지우고 빈 안내를 보인다', async () => {
    deleteAll.mockResolvedValue(undefined);
    await render(<MemoryScreen />);
    await pressRemoveAll();
    await fireEvent.press(screen.getByText('전부 지우기'));

    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText('아직 적힌 게 없어요')).toBeOnTheScreen();
    expect(screen.getAllByText('비어 있음')).toHaveLength(4);
  });

  test('취소하면 그대로 둔다', async () => {
    await render(<MemoryScreen />);
    await pressRemoveAll();
    await fireEvent.press(screen.getByText('취소'));
    expect(deleteAll).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('입시 합격')).toBeOnTheScreen();
  });

  test.each([
    [new Error('잠김'), '잠김'],
    [null, '잠시 후 다시 시도해주세요.'],
  ])('실패하면 이유를 알린다 (%#)', async (cause, message) => {
    deleteAll.mockRejectedValue(cause);
    await render(<MemoryScreen />);
    await pressRemoveAll();
    await fireEvent.press(screen.getByText('전부 지우기'));

    expect(await screen.findByText('지우지 못했어요')).toBeOnTheScreen();
    expect(screen.getByText(message)).toBeOnTheScreen();
  });
});

test('성별·나이는 프로필에서 적으라고 안내하고 프로필을 연다', async () => {
  await render(<MemoryScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: '프로필 열기' }));
  expect(mockRouter.push).toHaveBeenCalledWith('/profile-edit');
});
