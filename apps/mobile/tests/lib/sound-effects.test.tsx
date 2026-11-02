import { playSoundEffect } from '@/lib/sound-effects';

const mockPlay = jest.fn();
const mockRemove = jest.fn();
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({ play: mockPlay, remove: mockRemove, volume: 1 })),
}));

// 11/2 우영 — 효과음은 연습이 끝날 때와 불꽃이 나올 때 한 번씩만.
test('효과음을 한 번 재생하고 잠시 뒤 놓는다', () => {
  jest.useFakeTimers();
  playSoundEffect('flame');
  expect(mockPlay).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(3000);
  expect(mockRemove).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('오디오 모듈이 실패해도 던지지 않는다', () => {
  const { createAudioPlayer } = jest.requireMock('expo-audio') as { createAudioPlayer: jest.Mock };
  createAudioPlayer.mockImplementationOnce(() => {
    throw new Error('no audio');
  });
  expect(() => playSoundEffect('complete')).not.toThrow();
});
