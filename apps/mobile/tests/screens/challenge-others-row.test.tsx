import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ChallengeOthersRow, pickOthers } from '@/components/challenge-others-row';
import { api } from '@/lib/api';
import { resetEntryThumbs } from '@/lib/challenge/entry-thumbs';
import type { ChallengeCard, EntryCard } from '@/lib/challenge/types';

jest.mock('@/lib/api', () => ({ api: { listChallengeEntries: jest.fn() } }));
const mockThumbs = jest.fn(async () => [{ width: 240, height: 320 }]);
const mockRelease = jest.fn();
jest.mock('expo-video', () => ({
  createVideoPlayer: () => ({
    muted: false,
    status: 'readyToPlay',
    generateThumbnailsAsync: mockThumbs,
    release: mockRelease,
    addListener: () => ({ remove: () => undefined }),
  }),
}));

const challenge = { id: 'c1', entry_count: 3 } as ChallengeCard;
const entry = (over: Partial<EntryCard>): EntryCard =>
  ({
    id: 'e',
    challenge_id: 'c1',
    author: { id: 'u', name: '지우' },
    like_count: 2,
    view_count: 5,
    is_mine: false,
    playback_url: 'https://cdn.example/e.mp4',
    ...over,
  }) as EntryCard;

beforeEach(() => {
  resetEntryThumbs();
  jest.clearAllMocks();
});

test('내 것과 재생 주소 없는 참여작은 빼고 최대 6개만 고른다', () => {
  const list = [
    entry({ id: 'mine', is_mine: true }),
    entry({ id: 'nourl', playback_url: null }),
    ...Array.from({ length: 8 }, (_, i) => entry({ id: `o${i}` })),
  ];
  expect(pickOthers(list).map((e) => e.id)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4', 'o5']);
});

test('썸네일을 누르면 그 참여작을, 「전체 보기」를 누르면 상세를 연다. 아무도 안 본 영상엔 NEW', async () => {
  (api.listChallengeEntries as jest.Mock).mockResolvedValue({
    entries: [entry({ id: 'a', author: { id: 'u1', name: '민서' }, view_count: 0 }), entry({ id: 'b' })],
    next_cursor: null,
  });
  const onOpenEntry = jest.fn();
  const onOpenAll = jest.fn();
  await render(<ChallengeOthersRow challenge={challenge} onOpenAll={onOpenAll} onOpenEntry={onOpenEntry} />);
  const tile = await screen.findByRole('button', { name: '민서 영상 보기' });
  expect(api.listChallengeEntries).toHaveBeenCalledWith('c1', { sort: 'likes' });
  expect(screen.getAllByText('NEW')).toHaveLength(1);
  // iOS 네이티브는 시각 배열만 받는다(SOMA-1049).
  expect(mockThumbs).toHaveBeenCalledWith([0.5], expect.anything());
  await fireEvent.press(tile);
  expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  await fireEvent.press(screen.getByText('전체 보기'));
  expect(onOpenAll).toHaveBeenCalled();
  // 썸네일은 하나씩 뜨고 플레이어는 바로 놓는다.
  await act(async () => undefined);
  expect(mockThumbs).toHaveBeenCalled();
  expect(mockRelease).toHaveBeenCalledTimes(mockThumbs.mock.calls.length);
});

test('고를 참여작이 없으면 줄을 그리지 않는다', async () => {
  (api.listChallengeEntries as jest.Mock).mockResolvedValue({ entries: [entry({ is_mine: true })], next_cursor: null });
  await render(<ChallengeOthersRow challenge={challenge} onOpenAll={jest.fn()} onOpenEntry={jest.fn()} />);
  await act(async () => undefined);
  expect(screen.queryByText('다른 배우 영상')).not.toBeOnTheScreen();
});

test('참여작이 0개면 목록을 부르지도 않는다', async () => {
  await render(<ChallengeOthersRow challenge={{ ...challenge, entry_count: 0 }} onOpenAll={jest.fn()} onOpenEntry={jest.fn()} />);
  expect(api.listChallengeEntries).not.toHaveBeenCalled();
  expect(screen.queryByText('다른 배우 영상')).not.toBeOnTheScreen();
});
