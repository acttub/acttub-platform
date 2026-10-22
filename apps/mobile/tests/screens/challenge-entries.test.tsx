import { fireEvent, render, screen } from '@testing-library/react-native';

import ChallengeEntriesScreen from '@/app/challenge-entries';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { MyEntryCard } from '@/lib/challenge/types';
import { entryCard, ENDED_AT, RUNNING_ENDS_AT } from '../helpers/challenge-card';

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('@/lib/api', () => ({
  api: { listMyChallengeEntries: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const listMine = api.listMyChallengeEntries as jest.Mock;
const updateEntry = api.updateEntry as jest.Mock;
const deleteEntry = api.deleteEntry as jest.Mock;
const httpError = (status: number, code?: string) => Object.assign(new Error(`http ${status}`), { status, code });

function myEntry(overrides: Partial<MyEntryCard> = {}): MyEntryCard {
  const { is_new: _ignored, ...base } = entryCard({ id: 'e1', is_mine: true });
  return {
    ...base,
    playback_url: 'https://v/e1.mp4',
    content_version: 1,
    visibility: 'public',
    status: 'visible',
    category: 'public',
    challenge_hidden: false,
    challenge: { id: 'c1', line: '사느냐 죽느냐', work: '햄릿', character: '햄릿', ends_at: RUNNING_ENDS_AT },
    created_at: '2026-03-05T03:00:00Z',
    ...overrides,
  };
}

const pub = myEntry({ id: 'e1', view_count: 12, like_count: 3, caption: '첫 테이크' });
const priv = myEntry({
  id: 'e2',
  visibility: 'private',
  category: 'private',
  challenge: { id: 'c2', line: '내일은 내일의 해가', work: '바람과 함께', character: null, ends_at: RUNNING_ENDS_AT },
});
const review = myEntry({
  id: 'e3',
  visibility: 'private',
  status: 'hidden_by_report',
  category: 'under_review',
  challenge: { id: 'c3', line: '확인 중 대사', work: '작품', character: null, ends_at: RUNNING_ENDS_AT },
});
const gone = myEntry({ id: 'e4', status: 'deleted', challenge: { ...pub.challenge, line: '지운 대사' } });

function page(entries: MyEntryCard[], next_cursor: string | null = null) {
  return { counts: { all: 3, public: 1, private: 1, under_review: 1 }, entries, next_cursor };
}

beforeEach(() => {
  jest.clearAllMocks();
  listMine.mockResolvedValue(page([pub, priv, review, gone]));
  updateEntry.mockResolvedValue(undefined);
  deleteEntry.mockResolvedValue(undefined);
});

async function openMenuFor(line: string) {
  await fireEvent(await screen.findByText(line), 'longPress');
  expect(await screen.findByText('이 참여작')).toBeOnTheScreen();
}

test('서버가 센 분류 수와 지우지 않은 참여작을 상태와 함께 보여 준다', async () => {
  await render(<ChallengeEntriesScreen />);

  expect(await screen.findByText('“사느냐 죽느냐”')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '전체 3' })).toBeSelected();
  expect(screen.getByRole('button', { name: '공개 1' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '비공개 1' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '확인 중 1' })).toBeOnTheScreen();
  expect(screen.getByText('햄릿 · 햄릿 · 3월 5일')).toBeOnTheScreen();
  expect(screen.getByText('바람과 함께 · 3월 5일')).toBeOnTheScreen();
  expect(screen.getByText('조회 12 · 좋아요 3')).toBeOnTheScreen();
  expect(screen.getByText('비공개 저장')).toBeOnTheScreen();
  expect(screen.getByText('확인 중')).toBeOnTheScreen();
  expect(screen.queryByText('“지운 대사”')).not.toBeOnTheScreen();
});

test('분류를 고르면 그 분류만 보이고, 없으면 빈 안내를 띄운다', async () => {
  listMine.mockResolvedValue(page([pub, priv]));
  await render(<ChallengeEntriesScreen />);
  await screen.findByText('“사느냐 죽느냐”');

  await fireEvent.press(screen.getByRole('button', { name: '비공개 1' }));
  expect(screen.getByText('“내일은 내일의 해가”')).toBeOnTheScreen();
  expect(screen.queryByText('“사느냐 죽느냐”')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '확인 중 1' }));
  expect(screen.getByText('아직 참여한 챌린지가 없어요.')).toBeOnTheScreen();
});

test('다음 쪽이 있으면 이어 받아 한 목록으로 보여 준다', async () => {
  listMine.mockResolvedValueOnce(page([pub], 'cur-2')).mockResolvedValueOnce(page([priv], null));
  await render(<ChallengeEntriesScreen />);

  expect(await screen.findByText('“내일은 내일의 해가”')).toBeOnTheScreen();
  expect(listMine).toHaveBeenLastCalledWith(undefined, 'cur-2');
  expect(screen.queryByText('참여작이 많아 최근 것만 보여 드려요.')).not.toBeOnTheScreen();
});

test('100쪽을 받아도 더 있으면 최근 것만 보여 준다고 알린다', async () => {
  listMine.mockResolvedValue(page([], 'more'));
  await render(<ChallengeEntriesScreen />);

  expect(await screen.findByText('참여작이 많아 최근 것만 보여 드려요.')).toBeOnTheScreen();
  expect(listMine).toHaveBeenCalledTimes(100);
});

test('못 불러오면 이유만 보여 준다', async () => {
  listMine.mockRejectedValue(httpError(403));
  await render(<ChallengeEntriesScreen />);

  expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
  expect(screen.queryByText('아직 참여한 챌린지가 없어요.')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '전체 0' })).toBeOnTheScreen();
});

test('참여작을 누르면 그 참여작부터 재생하고, 뒤로는 이전 화면으로 간다', async () => {
  await render(<ChallengeEntriesScreen />);
  await fireEvent.press(await screen.findByText('“사느냐 죽느냐”'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenge-play', params: { id: 'c1', entryId: 'e1' } });

  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('메뉴에서 AI 리포트를 연다', async () => {
  await render(<ChallengeEntriesScreen />);
  await openMenuFor('“사느냐 죽느냐”');
  await fireEvent.press(screen.getByText('AI 리포트'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/ai-report', params: { entryId: 'e1' } });
});

describe('캡션 고치기', () => {
  test('고친 캡션을 다듬어 저장하고 다시 읽는다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“사느냐 죽느냐”');
    await fireEvent.press(screen.getByText('캡션 고치기'));

    const input = screen.getByDisplayValue('첫 테이크');
    await fireEvent.changeText(input, '  두 번째 테이크 ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));

    expect(updateEntry).toHaveBeenCalledWith('e1', { caption: '두 번째 테이크' });
    expect(await screen.findByText('캡션을 고쳤어요.')).toBeOnTheScreen();
    expect(screen.queryByDisplayValue('  두 번째 테이크 ')).not.toBeOnTheScreen();
    expect(listMine).toHaveBeenCalledTimes(2);
  });

  test('캡션이 없던 참여작은 빈 칸으로 열고, 취소하면 닫는다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“내일은 내일의 해가”');
    await fireEvent.press(screen.getByText('캡션 고치기'));

    expect(screen.getByDisplayValue('')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('캡션')).not.toBeOnTheScreen();
    expect(updateEntry).not.toHaveBeenCalled();
  });

  test('저장이 실패하면 이유를 알리고 편집기를 남긴다', async () => {
    updateEntry.mockRejectedValue(httpError(400, 'entry_hidden'));
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“사느냐 죽느냐”');
    await fireEvent.press(screen.getByText('캡션 고치기'));
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('확인 중인 참여작이라 공개로 바꿀 수 없어요.')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('첫 테이크')).toBeOnTheScreen();
  });
});

describe('공개 범위 바꾸기', () => {
  test('공개 참여작을 비공개로 바꾼다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“사느냐 죽느냐”');
    await fireEvent.press(screen.getByText('비공개로 바꾸기'));

    expect(updateEntry).toHaveBeenCalledWith('e1', { visibility: 'private' });
    expect(logEvent).toHaveBeenCalledWith('challenge_entry_visibility', { to: 'private' });
  });

  test('진행 중·정상인 비공개 참여작은 다시 공개한다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“내일은 내일의 해가”');
    await fireEvent.press(screen.getByText('공개로 바꾸기'));
    // 공개로 바꿀 때는 한 번 묻는다(SOMA-748 Avv5P0).
    expect(await screen.findByText('공개로 바꿀까요?')).toBeOnTheScreen();
    expect(updateEntry).not.toHaveBeenCalled();
    const labels = screen.getAllByText('공개로 바꾸기');
    await fireEvent.press(labels[labels.length - 1]);
    // 이어서 얼굴 모자이크를 켤지 묻는다(SOMA-809). 「그대로 공개」는 원본으로 공개한다.
    expect(await screen.findByText('얼굴 모자이크를 켤까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('그대로 공개'));
    expect(updateEntry).toHaveBeenCalledWith('e2', { visibility: 'public' });
  });

  test('다시 공개하면서 얼굴 모자이크를 켤 수 있다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“내일은 내일의 해가”');
    await fireEvent.press(screen.getByText('공개로 바꾸기'));
    const labels = await screen.findAllByText('공개로 바꾸기');
    await fireEvent.press(labels[labels.length - 1]);
    await fireEvent.press(await screen.findByText('모자이크하고 공개'));
    expect(updateEntry).toHaveBeenCalledWith('e2', { visibility: 'public', face_mosaic: true });
  });

  test('얼굴 모자이크를 메뉴에서 켜고, 만드는 중이면 목록에 알린다', async () => {
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“내일은 내일의 해가”');
    await fireEvent.press(screen.getByText('얼굴 모자이크 켜기'));
    expect(updateEntry).toHaveBeenCalledWith('e2', { face_mosaic: true });
  });

  test('바꾸기가 실패하면 이유를 알린다', async () => {
    updateEntry.mockRejectedValue(httpError(400, 'challenge_closed'));
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“사느냐 죽느냐”');
    await fireEvent.press(screen.getByText('비공개로 바꾸기'));
    expect(await screen.findByText('이 챌린지는 끝났어요. 영상은 보관함에 남아 있어요.')).toBeOnTheScreen();
  });

  test.each([
    ['확인 중인 참여작', { status: 'hidden_by_report' as const }, '확인 중인 참여작이라 공개로 바꿀 수 없어요.'],
    ['영상이 없는 참여작', { playback_url: null }, '아직 올릴 수 없는 영상이에요.'],
    [
      '끝난 챌린지의 참여작',
      { challenge: { id: 'c2', line: '내일은 내일의 해가', work: '바람과 함께', character: null, ends_at: ENDED_AT } },
      '이 챌린지는 끝났어요. 영상은 보관함에 남아 있어요.',
    ],
  ])('%s은 공개로 바꾸지 않고 이유를 알린다', async (_name, overrides, message) => {
    listMine.mockResolvedValue(page([{ ...priv, ...overrides }]));
    await render(<ChallengeEntriesScreen />);
    await openMenuFor('“내일은 내일의 해가”');
    await fireEvent.press(screen.getByText('공개로 바꾸기'));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(updateEntry).not.toHaveBeenCalled();
  });
});

describe('지우기', () => {
  const pressDelete = async () => {
    await openMenuFor('“사느냐 죽느냐”');
    await fireEvent.press(screen.getByText('지우기'));
    expect(await screen.findByText('참여작만 지워요. 영상은 보관함에 남아요.')).toBeOnTheScreen();
  };

  test('확인하면 지우고 다시 읽는다', async () => {
    await render(<ChallengeEntriesScreen />);
    await pressDelete();
    const labels = screen.getAllByText('지우기');
    await fireEvent.press(labels[labels.length - 1]);

    expect(deleteEntry).toHaveBeenCalledWith('e1');
    expect(logEvent).toHaveBeenCalledWith('challenge_entry_deleted', {});
    expect(listMine).toHaveBeenCalledTimes(2);
  });

  test('취소하면 지우지 않는다', async () => {
    await render(<ChallengeEntriesScreen />);
    await pressDelete();
    await fireEvent.press(screen.getByText('취소'));
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(screen.getByText('“사느냐 죽느냐”')).toBeOnTheScreen();
  });

  test('실패하면 이유를 알린다', async () => {
    deleteEntry.mockRejectedValue(httpError(404));
    await render(<ChallengeEntriesScreen />);
    await pressDelete();
    const labels = screen.getAllByText('지우기');
    await fireEvent.press(labels[labels.length - 1]);
    expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
  });
});

test('행 오른쪽 더 보기 버튼도 같은 메뉴를 연다', async () => {
  listMine.mockResolvedValue(page([pub]));
  await render(<ChallengeEntriesScreen />);
  await screen.findByText('“사느냐 죽느냐”');

  const buttons = screen.getAllByRole('button');
  await fireEvent.press(buttons[buttons.length - 1]);
  expect(await screen.findByText('이 참여작')).toBeOnTheScreen();
});
