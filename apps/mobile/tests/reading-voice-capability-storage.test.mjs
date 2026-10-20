import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const capability = await import('../lib/reading/voice-capability.ts');
const { APP_VOICE_UNSUPPORTED_KEY: UNSUPPORTED, MODEL_LOAD_STARTED_KEY: STARTED } = capability;

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('기기 저장소의 표시로 앱 목소리를 쓸 수 있는지 읽고 남긴다', async () => {
  assert.deepEqual(await capability.readAppVoiceSupport(), { unsupported: false });

  await capability.markModelLoadStarted();
  assert.equal(state.items.get(STARTED), '1');
  await capability.markModelLoadEnded();
  assert.equal(state.items.has(STARTED), false);

  await capability.markModelLoadStarted();
  assert.deepEqual(await capability.readAppVoiceSupport(), { unsupported: true, noticed: false });
  assert.equal(state.items.get(UNSUPPORTED), '1');
  assert.equal(state.items.has(STARTED), false);

  await capability.markAppVoiceNoticed();
  assert.deepEqual(await capability.readAppVoiceSupport(), { unsupported: true, noticed: true });
});

test('못 쓴다고 남기면 불러오기 시작 표시도 지운다', async () => {
  state.items.set(STARTED, '1');
  await capability.markAppVoiceUnsupported();

  assert.equal(state.items.get(UNSUPPORTED), '1');
  assert.equal(state.items.has(STARTED), false);
});

test('저장소를 못 쓰면 쓸 수 있는 것으로 보고 표시 남기기는 조용히 넘어간다', async () => {
  state.broken = true;

  assert.deepEqual(await capability.readAppVoiceSupport(), { unsupported: false });
  await capability.markModelLoadStarted();
  await capability.markModelLoadEnded();
  await capability.markAppVoiceUnsupported();
  await capability.markAppVoiceNoticed();
  assert.equal(state.items.size, 0);
});
