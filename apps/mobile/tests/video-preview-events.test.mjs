import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewTracker } from '../lib/video-preview-events.ts';

/** 사용자가 자기 영상을 틀어 봤는지 영상 하나당 한 번씩만 센다. */

function setup(screen = 'upload') {
  const sent = [];
  const tracker = createPreviewTracker(screen, (name, params) => sent.push([name, params]));
  return { sent, tracker };
}

test('영상이 걸리기 전에는 세지 않는다', () => {
  const { sent, tracker } = setup();
  tracker.onPlaying(true);
  tracker.onEnd();
  assert.deepEqual(sent, []);
});

test('재생을 시작하면 한 번 남기고, 멈췄다 다시 틀어도 다시 세지 않는다', () => {
  const { sent, tracker } = setup();
  tracker.setSource('file:///a.mp4', { sample: false, continued: false });
  tracker.onPlaying(false);
  tracker.onPlaying(true);
  tracker.onPlaying(false);
  tracker.onPlaying(true);
  assert.deepEqual(sent, [['video_preview_play', { screen: 'upload', sample: false, continued: false }]]);
});

test('끝까지 보면 한 번 남기고, 반복 재생으로 또 끝나도 다시 세지 않는다', () => {
  const { sent, tracker } = setup('archive');
  tracker.setSource('video-1');
  tracker.onPlaying(true);
  tracker.onEnd();
  tracker.onEnd();
  assert.deepEqual(sent.map(([name]) => name), ['video_preview_play', 'video_preview_end']);
  assert.equal(sent[1][1].screen, 'archive');
});

test('다른 영상으로 바꾸면 새로 센다', () => {
  const { sent, tracker } = setup();
  tracker.setSource('file:///a.mp4');
  tracker.onPlaying(true);
  tracker.setSource('file:///b.mp4');
  tracker.onPlaying(true);
  assert.equal(sent.length, 2);
});

test('같은 영상이면 다시 걸어도 다시 세지 않는다', () => {
  const { sent, tracker } = setup();
  tracker.setSource('file:///a.mp4');
  tracker.onPlaying(true);
  tracker.setSource('file:///a.mp4');
  tracker.onPlaying(true);
  assert.equal(sent.length, 1);
});
