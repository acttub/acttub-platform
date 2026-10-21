import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.require = name => {
  assert.equal(name, '@/assets/dev/sample-take.mp4');
  return 7;
};
const { previewVideoSource } = await import('../lib/preview-video.ts');

test('개발 빌드에서만 미리보기 영상을 싣는다', () => {
  globalThis.__DEV__ = false;
  assert.equal(previewVideoSource(), null);
  globalThis.__DEV__ = true;
  assert.equal(previewVideoSource(), 7);
});
