import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const { VOICE_FEEDBACK_KEY, loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } = await import('../lib/reading/voice-feedback-setting.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('발음 피드백은 기본 꺼짐이고 켬·끔을 기기에 남긴다', async () => {
  assert.equal(await loadVoiceFeedbackEnabled(), false);
  await saveVoiceFeedbackEnabled(true);
  assert.equal(state.items.get(VOICE_FEEDBACK_KEY), '1');
  assert.equal(await loadVoiceFeedbackEnabled(), true);
  await saveVoiceFeedbackEnabled(false);
  assert.equal(state.items.get(VOICE_FEEDBACK_KEY), '0');
});

test('저장소를 못 읽으면 꺼진 것으로 본다', async () => {
  state.broken = true;
  assert.equal(await loadVoiceFeedbackEnabled(), false);
});
