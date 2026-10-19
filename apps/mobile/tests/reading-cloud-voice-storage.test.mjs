import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const { CLOUD_VOICE_KEY, loadCloudVoiceEnabled, saveCloudVoiceEnabled } = await import('../lib/reading/cloud-voice.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('고품질 목소리 켬·끔을 기기에 남기고 읽는다', async () => {
  assert.equal(await loadCloudVoiceEnabled(), false);
  await saveCloudVoiceEnabled(true);
  assert.equal(state.items.get(CLOUD_VOICE_KEY), 'on');
  assert.equal(await loadCloudVoiceEnabled(), true);
  await saveCloudVoiceEnabled(false);
  assert.equal(state.items.get(CLOUD_VOICE_KEY), 'off');
  assert.equal(await loadCloudVoiceEnabled(), false);
});

test('저장소를 못 읽으면 꺼진 것으로 본다', async () => {
  state.broken = true;
  assert.equal(await loadCloudVoiceEnabled(), false);
});
