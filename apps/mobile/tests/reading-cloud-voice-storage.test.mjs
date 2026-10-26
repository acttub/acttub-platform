import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const { CLOUD_VOICE_KEY, loadCloudVoiceEnabled, saveCloudVoiceEnabled } = await import('../lib/reading/cloud-voice.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('고품질 목소리 켬·끔을 기기에 남기고 읽는다 — 한 번도 안 건드렸으면 켜짐(10/25 사용자 결정)', async () => {
  assert.equal(await loadCloudVoiceEnabled(), true);
  await saveCloudVoiceEnabled(true);
  assert.equal(state.items.get(CLOUD_VOICE_KEY), 'on');
  assert.equal(await loadCloudVoiceEnabled(), true);
  await saveCloudVoiceEnabled(false);
  assert.equal(state.items.get(CLOUD_VOICE_KEY), 'off');
  assert.equal(await loadCloudVoiceEnabled(), false);
});

test('저장소를 못 읽으면 기본(켜짐)으로 본다 — 동의·서버 한도는 따로 막는다', async () => {
  state.broken = true;
  assert.equal(await loadCloudVoiceEnabled(), true);
});
