import assert from 'node:assert/strict';
import test from 'node:test';

const { setRecordedVideo, takeRecordedVideo } = await import('../lib/recorded-video.ts');

test('SOMA-477: 넣은 촬영 결과를 그대로 꺼낸다', () => {
  setRecordedVideo({ uri: 'file:///take1.mov', durationMs: 42000, name: 'take1.mov' });
  const v = takeRecordedVideo();
  assert.equal(v?.uri, 'file:///take1.mov');
  assert.equal(v?.durationMs, 42000);
});

test('SOMA-477: 한 번 꺼내면 비워진다(두 번 소비 금지)', () => {
  setRecordedVideo({ uri: 'file:///take2.mov', durationMs: null, name: 'take2.mov' });
  assert.ok(takeRecordedVideo());
  assert.equal(takeRecordedVideo(), null);
});

test('SOMA-477: 넣은 적 없으면 null', () => {
  // 앞 테스트에서 이미 비워진 상태
  assert.equal(takeRecordedVideo(), null);
});
