import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubModules } from './helpers/m4-stubs.mjs';

globalThis.require = name => {
  assert.equal(name, '@/assets/tutorial/sample-scene.mp4');
  return 42;
};
stubModules({
  'expo-asset': 'export const Asset = { fromModule: id => ({ uri: `file:///bundle/asset-${id}.mp4` }) };',
  '@/lib/api': 'export const api = { name: "server" };',
});
const { loopApiFor, sampleVideoUri } = await import('../lib/tutorial-loop.ts');

test('예시 연습이면 기기 안의 예시 흐름을, 아니면 서버를 쓴다', async () => {
  assert.deepEqual(loopApiFor('some-practice'), { name: 'server' });
  assert.deepEqual(loopApiFor(null), { name: 'server' });
  const sample = loopApiFor('tutorial-sample-practice');
  assert.notEqual(sample.name, 'server');
  assert.equal(loopApiFor('tutorial-sample-practice'), sample, 'one sample loop per run');
});

test('예시 영상은 앱에 실린 파일 주소다', () => {
  assert.equal(sampleVideoUri(), 'file:///bundle/asset-42.mp4');
});
