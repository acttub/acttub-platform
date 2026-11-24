import { act, render, screen } from '@testing-library/react-native';

import { SceneFoldBody, logFoldOpen } from '@/components/practice-chrome';
import { logEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

// expo-video 는 네이티브 플레이어라, 실제 훅처럼 소스가 바뀔 때마다 플레이어를 새로 만들고 setup 을 부르는 가짜로 바꾼다.
jest.mock('expo-video', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const players: Record<string, unknown>[] = [];
  const makePlayer = (source: unknown) => {
    const listeners: Record<string, Set<(payload: unknown) => void>> = {};
    const player = {
      source,
      loop: true,
      addListener(name: string, fn: (payload: unknown) => void) {
        (listeners[name] ??= new Set()).add(fn);
        return { remove: () => listeners[name].delete(fn) };
      },
      emit(name: string, payload?: unknown) {
        for (const fn of listeners[name] ?? []) fn(payload);
      },
    };
    players.push(player);
    return player;
  };
  return {
    mockPlayers: players,
    useVideoPlayer: (source: unknown, setup?: (p: unknown) => void) =>
      React.useMemo(() => {
        const player = makePlayer(source);
        setup?.(player);
        return player;
      }, [JSON.stringify(source)]),
    VideoView: ({ player }: { player: { source: unknown } }) => React.createElement(RNText, null, `영상 재생기: ${String(player.source)}`),
  };
});

type FakePlayer = { source: unknown; loop: boolean; emit: (name: string, payload?: unknown) => void };
const { mockPlayers } = jest.requireMock('expo-video') as { mockPlayers: FakePlayer[] };
const log = logEvent as jest.Mock;
const lastPlayer = () => mockPlayers[mockPlayers.length - 1];

beforeEach(() => {
  log.mockClear();
  mockPlayers.length = 0;
});

test('logFoldOpen 은 화면 이름을 실어 펼침 이벤트를 보낸다', () => {
  logFoldOpen('coach');
  expect(log.mock.calls).toEqual([['video_fold_open', { screen: 'coach' }]]);
});

describe('SceneFoldBody', () => {
  test('접혀 있으면 아무것도 그리지 않고 영상도 걸지 않는다', async () => {
    await render(<SceneFoldBody open={false} videoUri="file:///take.mp4" track="analyzing" />);
    expect(screen.queryByText(/영상 재생기/)).not.toBeOnTheScreen();
    expect(screen.queryByText('다시 볼 수 있는 영상이 없어요.')).not.toBeOnTheScreen();
    expect(lastPlayer().source).toBeNull();
  });

  test('펼치면 영상을 반복 없이 걸고, 처음 틀 때와 끝까지 볼 때를 한 번씩 남긴다', async () => {
    await render(<SceneFoldBody open videoUri="file:///take.mp4" track="analyzing" />);
    expect(screen.getByText('영상 재생기: file:///take.mp4')).toBeOnTheScreen();
    expect(lastPlayer().loop).toBe(false);

    await act(async () => {
      lastPlayer().emit('playingChange', { isPlaying: true });
      lastPlayer().emit('playingChange', { isPlaying: false });
      lastPlayer().emit('playingChange', { isPlaying: true });
      lastPlayer().emit('playToEnd');
    });

    expect(log.mock.calls).toEqual([
      ['video_preview_play', { screen: 'analyzing' }],
      ['video_preview_end', { screen: 'analyzing' }],
    ]);
  });

  test('번들 영상(숫자 에셋)도 영상으로 보고 센다', async () => {
    await render(<SceneFoldBody open videoUri={7} track="coach" />);
    expect(screen.getByText('영상 재생기: 7')).toBeOnTheScreen();
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log.mock.calls).toEqual([['video_preview_play', { screen: 'coach' }]]);
  });

  test.each([
    ['빈 주소', ''],
    ['주소 없음', null],
  ])('%s 이면 영상 대신 없다고 알리고 세지 않는다', async (_, videoUri) => {
    await render(<SceneFoldBody open videoUri={videoUri} track="coach" />);
    expect(screen.getByText('다시 볼 수 있는 영상이 없어요.')).toBeOnTheScreen();
    expect(screen.queryByText(/영상 재생기/)).not.toBeOnTheScreen();
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log).not.toHaveBeenCalled();
  });

  test('기록할 화면을 주지 않으면 틀어도 남기지 않는다', async () => {
    await render(<SceneFoldBody open videoUri="file:///take.mp4" />);
    await act(async () => lastPlayer().emit('playingChange', { isPlaying: true }));
    expect(log).not.toHaveBeenCalled();
  });
});
