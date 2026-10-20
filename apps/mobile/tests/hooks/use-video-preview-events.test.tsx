import { act, render } from '@testing-library/react-native';

import { useVideoPreviewEvents } from '@/hooks/use-video-preview-events';
import { logEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

function fakePlayer() {
  const listeners = new Map<string, (event: { isPlaying?: boolean }) => void>();
  return {
    listeners,
    addListener(name: string, fn: (event: { isPlaying?: boolean }) => void) {
      listeners.set(name, fn);
      return { remove: () => listeners.delete(name) };
    },
    emit(name: string, event: { isPlaying?: boolean } = {}) {
      listeners.get(name)?.(event);
    },
  };
}

function Host({ player, source, params }: { player: ReturnType<typeof fakePlayer>; source: string | null; params?: Record<string, string> }) {
  useVideoPreviewEvents(player as never, 'archive', source, params);
  return null;
}

beforeEach(() => jest.clearAllMocks());

test('영상을 처음 틀고 끝까지 본 것을 한 번씩만 남긴다', async () => {
  const player = fakePlayer();
  await render(<Host player={player} source="video-1" params={{ from: 'list' }} />);

  await act(async () => {
    player.emit('playingChange', { isPlaying: false });
    player.emit('playingChange', { isPlaying: true });
    player.emit('playingChange', { isPlaying: true });
    player.emit('playToEnd');
    player.emit('playToEnd');
  });

  expect((logEvent as jest.Mock).mock.calls).toEqual([
    ['video_preview_play', { screen: 'archive', from: 'list' }],
    ['video_preview_end', { screen: 'archive', from: 'list' }],
  ]);
});

test('영상이 바뀌면 다시 세고, 걸린 영상이 없으면 세지 않는다', async () => {
  const player = fakePlayer();
  const view = await render(<Host player={player} source={null} />);
  await act(async () => player.emit('playingChange', { isPlaying: true }));
  expect(logEvent).not.toHaveBeenCalled();

  await view.rerender(<Host player={player} source="video-2" />);
  await act(async () => player.emit('playingChange', { isPlaying: true }));
  expect((logEvent as jest.Mock).mock.calls).toEqual([['video_preview_play', { screen: 'archive' }]]);

  await view.unmount();
  expect(player.listeners.size).toBe(0);
});
