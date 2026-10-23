import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Share } from 'react-native';

import ChallengeDetailScreen from '@/app/challenge-detail';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { ChallengeDetail, EntryCard } from '@/lib/challenge/types';
import { challengeCard, entryCard, RUNNING_ENDS_AT } from '../helpers/challenge-card';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: { id?: string } = {};
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
jest.mock('@/lib/api', () => ({
  api: {
    getChallenge: jest.fn(),
    listChallengeEntries: jest.fn(),
    deleteChallenge: jest.fn(),
    createReport: jest.fn(),
  },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/request-id', () => ({ newRequestId: () => 'req-1' }));

const getChallenge = api.getChallenge as jest.Mock;
const listEntries = api.listChallengeEntries as jest.Mock;
const deleteChallenge = api.deleteChallenge as jest.Mock;
const createReport = api.createReport as jest.Mock;
const httpError = (status: number, code?: string) => Object.assign(new Error(`http ${status}`), { status, code });

function detail(overrides: Partial<ChallengeDetail> = {}): ChallengeDetail {
  return {
    ...challengeCard({
      id: 'c1',
      line: '사느냐 죽느냐',
      work: '햄릿',
      character: '햄릿',
      scene_note: '독백 장면',
      origin: 'member',
      host_name: '태오',
      ends_at: RUNNING_ENDS_AT,
      featured_on: '2026-10-20',
      entry_count: 2,
      like_sum: 7,
    }),
    ranking_state: null,
    ...overrides,
  };
}

const top = entryCard({
  id: 'e1',
  author: { name: '윤서', user_id: 'u1' },
  caption: '첫 테이크',
  like_count: 5,
  rank: 1,
  published_at: '2020-01-02T00:00:00Z',
});
const second = entryCard({ id: 'e2', author: { name: '민재', user_id: 'u2' }, like_count: 0, rank: 2, is_new: true, published_at: null });

function entries(list: EntryCard[], next_cursor: string | null = null) {
  return { entries: list, next_cursor, ranking_state: null };
}

const header = () => within(screen.getByTestId('header'));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'c1' };
  getChallenge.mockResolvedValue(detail());
  listEntries.mockResolvedValue(entries([top, second]));
});

test('진행 중인 오늘의 챌린지와 좋아요순 순위를 보여 준다', async () => {
  await render(<ChallengeDetailScreen />);

  expect(await screen.findByText('“사느냐 죽느냐”')).toBeOnTheScreen();
  expect(listEntries).toHaveBeenCalledWith('c1', { sort: 'likes' });
  expect(header().getByText('오늘의 챌린지')).toBeOnTheScreen();
  expect(screen.getByText('햄릿 · 햄릿')).toBeOnTheScreen();
  expect(screen.getByText('독백 장면')).toBeOnTheScreen();
  expect(screen.getByText(/^태오 님이 연 대사 · D-\d+$/)).toBeOnTheScreen();
  expect(screen.getByText('참여작 2 · 좋아요 7')).toBeOnTheScreen();
  expect(screen.getByText('1')).toBeOnTheScreen();
  expect(screen.getByText('2')).toBeOnTheScreen();
  expect(screen.getByText('현재 1위 · 좋아요 5')).toBeOnTheScreen();
  expect(screen.getByText('첫 테이크')).toBeOnTheScreen();
  expect(screen.getByText('2020년 1월 2일 · 좋아요 5')).toBeOnTheScreen();
  expect(screen.queryByText('NEW')).not.toBeOnTheScreen();
});

test('참여작을 누르면 그 참여작부터 재생하고, 연기하기는 촬영으로 간다', async () => {
  await render(<ChallengeDetailScreen />);

  await fireEvent.press(await screen.findByText('윤서'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenge-play', params: { id: 'c1', entryId: 'e1' } });

  await fireEvent.press(screen.getByRole('button', { name: '나도 이 대사 연기하기' }));
  expect(logEvent).toHaveBeenCalledWith('challenge_perform_tap', { id: 'c1' });
  expect(mockRouter.push).toHaveBeenLastCalledWith({
    pathname: '/record-video',
    params: { mode: 'challenge', challengeId: 'c1', line: '사느냐 죽느냐', work: '햄릿' },
  });
});

test('최신순은 순위 없이 가장 최근 하나에 NEW를 붙인다', async () => {
  await render(<ChallengeDetailScreen />);
  await screen.findByText('윤서');
  listEntries.mockResolvedValue(entries([second, { ...top, rank: null }]));

  await fireEvent.press(screen.getByRole('button', { name: '최신순' }));

  expect(await screen.findByText('NEW')).toBeOnTheScreen();
  expect(listEntries).toHaveBeenLastCalledWith('c1', { sort: 'latest' });
  expect(screen.getByRole('button', { name: '최신순' })).toBeSelected();
  expect(screen.queryByText('현재 1위 · 좋아요 5')).not.toBeOnTheScreen();
  expect(screen.queryByText('1')).not.toBeOnTheScreen();
});

test('종료 뒤 집계 중이면 순위와 배지를 감추고 촬영 버튼을 없앤다', async () => {
  getChallenge.mockResolvedValue(
    detail({ ends_at: '2020-01-08T00:00:00Z', ranking_state: 'pending', origin: 'team', character: null, scene_note: null }),
  );
  await render(<ChallengeDetailScreen />);

  expect(await screen.findByText('집계 중이에요. 곧 순위가 정해져요.')).toBeOnTheScreen();
  expect(header().getByText('챌린지')).toBeOnTheScreen();
  expect(screen.getByText('Acttub 공식 대사 · 종료')).toBeOnTheScreen();
  expect(screen.getByText('햄릿')).toBeOnTheScreen();
  expect(screen.getByText('참여작 2 · 좋아요 7')).toBeOnTheScreen();
  expect(screen.getByText('윤')).toBeOnTheScreen();
  expect(screen.queryByText('1')).not.toBeOnTheScreen();
  expect(screen.queryByText(/1위/)).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '나도 이 대사 연기하기' })).not.toBeOnTheScreen();
});

test('종료 뒤 확정되면 마감 때 좋아요 수로 1위를 표시한다', async () => {
  getChallenge.mockResolvedValue(detail({ ends_at: '2020-01-08T00:00:00Z', ranking_state: 'final' }));
  listEntries.mockResolvedValue(entries([{ ...top, final_like_count: 4 }]));
  await render(<ChallengeDetailScreen />);

  expect(await screen.findByText('종료된 챌린지예요. 순위가 굳었어요.')).toBeOnTheScreen();
  expect(screen.getByText('1위 · 좋아요 4')).toBeOnTheScreen();
});

test('운영 검토 중인 내 챌린지면 목록에 보이지 않는다고 알린다', async () => {
  getChallenge.mockResolvedValue(detail({ moderation: 'review' }));
  await render(<ChallengeDetailScreen />);
  expect(await screen.findByText('운영 검토 중이라 목록에 보이지 않아요.')).toBeOnTheScreen();
});

test('참여작이 없으면 첫 참여를 권한다', async () => {
  listEntries.mockResolvedValue(entries([]));
  await render(<ChallengeDetailScreen />);
  expect(await screen.findByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.')).toBeOnTheScreen();
});

test('불러오지 못하면 이유를 보여 준다', async () => {
  getChallenge.mockRejectedValue(httpError(404));
  await render(<ChallengeDetailScreen />);

  expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
  expect(screen.queryByText('아직 참여작이 없어요. 첫 번째로 참여해 보세요.')).not.toBeOnTheScreen();
});

test('id 없이 열면 아무것도 읽지 않는다', async () => {
  mockParams = {};
  await render(<ChallengeDetailScreen />);
  expect(getChallenge).not.toHaveBeenCalled();
  expect(header().getByText('챌린지')).toBeOnTheScreen();
});

describe('참여작 더 보기', () => {
  const third = entryCard({ id: 'e3', author: { name: '하린', user_id: 'u3' }, rank: 3 });

  test('다음 묶음을 이어 붙이고 더 없으면 버튼을 거둔다', async () => {
    listEntries.mockResolvedValueOnce(entries([top], 'cur-2')).mockResolvedValueOnce(entries([third]));
    await render(<ChallengeDetailScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '참여작 더 보기' }));

    expect(await screen.findByText('하린')).toBeOnTheScreen();
    expect(listEntries).toHaveBeenLastCalledWith('c1', { sort: 'likes', cursor: 'cur-2' });
    expect(screen.getByText('윤서')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '참여작 더 보기' })).not.toBeOnTheScreen();
  });

  test('순위가 바뀌어 커서가 만료되면 처음부터 다시 읽는다', async () => {
    listEntries
      .mockResolvedValueOnce(entries([top], 'cur-2'))
      .mockRejectedValueOnce(httpError(410, 'cursor_expired'))
      .mockResolvedValueOnce(entries([third]));
    await render(<ChallengeDetailScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '참여작 더 보기' }));

    expect(await screen.findByText('하린')).toBeOnTheScreen();
    expect(screen.queryByText('윤서')).not.toBeOnTheScreen();
    expect(listEntries).toHaveBeenLastCalledWith('c1', { sort: 'likes' });
  });

  test('다른 실패는 이유를 보여 준다', async () => {
    listEntries.mockResolvedValueOnce(entries([top], 'cur-2')).mockRejectedValueOnce(httpError(403));
    await render(<ChallengeDetailScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '참여작 더 보기' }));

    expect(await screen.findByText('챌린지는 회원만 이용할 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByText('윤서')).toBeOnTheScreen();
  });

  test('받는 동안 정렬을 바꾸면 늦게 온 이전 정렬 결과를 버린다', async () => {
    let resolveMore!: (v: unknown) => void;
    listEntries
      .mockResolvedValueOnce(entries([top], 'cur-2'))
      .mockReturnValueOnce(new Promise((r) => (resolveMore = r)))
      .mockResolvedValueOnce(entries([second]));
    await render(<ChallengeDetailScreen />);

    await fireEvent.press(await screen.findByRole('button', { name: '참여작 더 보기' }));
    await fireEvent.press(screen.getByRole('button', { name: '최신순' }));
    expect(await screen.findByText('민재')).toBeOnTheScreen();

    await act(async () => resolveMore(entries([third])));
    expect(screen.queryByText('하린')).not.toBeOnTheScreen();
  });
});

describe('주최자의 지우기', () => {
  beforeEach(() => {
    getChallenge.mockResolvedValue(detail({ is_host: true, entry_count: 0 }));
    listEntries.mockResolvedValue(entries([]));
  });

  const pressTrash = async () => {
    await screen.findByText('“사느냐 죽느냐”');
    const [trash] = header().getAllByRole('button');
    await fireEvent.press(trash);
    expect(await screen.findByText('이 챌린지를 지울까요?')).toBeOnTheScreen();
  };

  test('확인하면 지우고 이전 화면으로 간다', async () => {
    deleteChallenge.mockResolvedValue(undefined);
    await render(<ChallengeDetailScreen />);
    await pressTrash();

    await fireEvent.press(screen.getByText('지우기'));

    expect(deleteChallenge).toHaveBeenCalledWith('c1');
    expect(logEvent).toHaveBeenCalledWith('challenge_deleted', { id: 'c1' });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  test('취소하면 지우지 않는다', async () => {
    await render(<ChallengeDetailScreen />);
    await pressTrash();
    await fireEvent.press(screen.getByText('취소'));
    expect(deleteChallenge).not.toHaveBeenCalled();
    expect(screen.getByText('“사느냐 죽느냐”')).toBeOnTheScreen();
  });

  test('그사이 참여작이 생겼으면 지울 수 없다고 알린다', async () => {
    deleteChallenge.mockRejectedValue(httpError(422, 'challenge_has_entries'));
    await render(<ChallengeDetailScreen />);
    await pressTrash();
    await fireEvent.press(screen.getByText('지우기'));
    expect(await screen.findByText('참여작이 있어 지울 수 없어요.')).toBeOnTheScreen();
  });

  test('없는 챌린지면 그렇게 알린다', async () => {
    deleteChallenge.mockRejectedValue(httpError(404));
    await render(<ChallengeDetailScreen />);
    await pressTrash();
    await fireEvent.press(screen.getByText('지우기'));
    expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('남의 챌린지 신고', () => {
  const report = async () => {
    await screen.findByText('“사느냐 죽느냐”');
    const [flag] = header().getAllByRole('button');
    await fireEvent.press(flag);
    expect(await screen.findByText('이 대사를 신고할까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: /부적절한 콘텐츠/ }));
    await fireEvent.press(screen.getByRole('button', { name: '신고하기' }));
  };

  test('사유를 골라 보내면 접수됐다고 알린다', async () => {
    createReport.mockResolvedValue(undefined);
    await render(<ChallengeDetailScreen />);
    await report();

    expect(createReport).toHaveBeenCalledWith({
      request_id: 'req-1',
      target_type: 'challenge',
      target_id: 'c1',
      reason: 'inappropriate',
    });
    expect(logEvent).toHaveBeenCalledWith('challenge_report', { reason: 'inappropriate', target: 'challenge' });
    expect(await screen.findByText('신고를 접수했어요. 운영이 확인할게요.')).toBeOnTheScreen();
  });

  test('하루 한도를 넘기면 그렇게 알린다', async () => {
    createReport.mockRejectedValue(httpError(429));
    await render(<ChallengeDetailScreen />);
    await report();
    expect(await screen.findByText('신고는 하루 20건까지 할 수 있어요.')).toBeOnTheScreen();
  });

  test('취소하면 시트를 닫는다', async () => {
    await render(<ChallengeDetailScreen />);
    await screen.findByText('“사느냐 죽느냐”');
    await fireEvent.press(header().getAllByRole('button')[0]);
    await fireEvent.press(await screen.findByText('취소'));
    expect(screen.queryByText('이 대사를 신고할까요?')).not.toBeOnTheScreen();
    expect(createReport).not.toHaveBeenCalled();
    expect(screen.getByText('“사느냐 죽느냐”')).toBeOnTheScreen();
  });
});

test('공유는 작품과 대사를 담은 문구를 보낸다', async () => {
  const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('dismissed'));
  await render(<ChallengeDetailScreen />);
  await screen.findByText('“사느냐 죽느냐”');

  const buttons = header().getAllByRole('button');
  await fireEvent.press(buttons[buttons.length - 1]);

  expect(logEvent).toHaveBeenCalledWith('challenge_share', { id: 'c1' });
  expect(share).toHaveBeenCalledWith({ message: '햄릿의 “사느냐 죽느냐” 연기 — acttub 챌린지' });
});

test('불러오기 전에는 머리 버튼이 공유뿐이고 눌러도 아무것도 하지 않는다', async () => {
  const share = jest.spyOn(Share, 'share');
  getChallenge.mockReturnValue(new Promise(() => undefined));
  await render(<ChallengeDetailScreen />);

  const buttons = header().getAllByRole('button');
  expect(buttons).toHaveLength(1);
  await fireEvent.press(buttons[0]);
  expect(share).not.toHaveBeenCalled();
});
