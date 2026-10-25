import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/stub-modules.mjs';

// 올리기 옵션(P3.26): 「분석 끝나면 영상 바로 지우기」 기억·파기와 얼굴 가리기 업로드 표시.
const state = { storage: memoryStorage(), purged: [], forgot: [], purgeFails: false };
globalThis.__uploadOptions = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__uploadOptions.storage;',
  '@/lib/api': `const s = globalThis.__uploadOptions;
    export const api = { purgeVideoFile: async (id) => { if (s.purgeFails) throw new Error('down'); s.purged.push(id); return { id }; } };`,
  '@/lib/library/library-runner': `const s = globalThis.__uploadOptions;
    export const forgetLocalCopy = async (id) => { s.forgot.push(id); };`,
});
const opts = await import('../lib/practice/upload-options.ts');

beforeEach(() => {
  state.storage = memoryStorage();
  state.purged = [];
  state.forgot = [];
  state.purgeFails = false;
});

test('지우기를 고른 회차만 기억하고, 노트가 열리면 서버에 파일 파기를 요청한 뒤 잊는다', async () => {
  assert.equal(await opts.isPurgeAfterAnalysis('p1'), false);
  assert.equal(await opts.purgeVideoFileIfDue('p1'), false);
  await opts.rememberPurgeAfterAnalysis('p1', 'v1');
  assert.equal(await opts.isPurgeAfterAnalysis('p1'), true);
  assert.equal(await opts.isPurgeAfterAnalysis('p2'), false);

  assert.equal(await opts.purgeVideoFileIfDue('p1'), true);
  assert.deepEqual(state.purged, ['v1']);
  assert.deepEqual(state.forgot, ['v1']);
  assert.equal(await opts.isPurgeAfterAnalysis('p1'), false);
  assert.equal(await opts.purgeVideoFileIfDue('p1'), false);
});

test('파기 요청이 실패하면 적어 둔 채로 남겨 다음에 다시 시도한다', async () => {
  await opts.rememberPurgeAfterAnalysis('p3', 'v3');
  state.purgeFails = true;
  assert.equal(await opts.purgeVideoFileIfDue('p3'), false);
  assert.equal(await opts.isPurgeAfterAnalysis('p3'), true);
  state.purgeFails = false;
  assert.equal(await opts.purgeVideoFileIfDue('p3'), true);
  assert.deepEqual(state.purged, ['v3']);
});

test('저장 값이 깨져 있으면 빈 것으로 본다', async () => {
  await state.storage.setItem('acttub.practice.purgeAfterAnalysis', '{not json');
  assert.equal(await opts.isPurgeAfterAnalysis('p1'), false);
});

test('얼굴 가리기 업로드 표시는 켜고 끌 수 있다', () => {
  assert.equal(opts.faceMosaicForNextUpload(), false);
  opts.setFaceMosaicForUploads(true);
  assert.equal(opts.faceMosaicForNextUpload(), true);
  opts.setFaceMosaicForUploads(false);
  assert.equal(opts.faceMosaicForNextUpload(), false);
});
