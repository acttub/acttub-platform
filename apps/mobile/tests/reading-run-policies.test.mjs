import assert from 'node:assert/strict';
import test from 'node:test';

import { sttPolicy } from '../lib/reading/stt-policy.ts';
import { VOICE_FAILURE_CHOICES, modelDownloadPrompt, voiceFallbackDefault } from '../lib/reading/voice-policy.ts';
import { GUIDE_SEEN_KEY, hasSeenReadingGuide, markReadingGuideSeen } from '../lib/reading/guide-flag.ts';

test('reading.session: 플랫폼 STT는 기기 안 처리를 보장할 때만 켜고 아니면 입력하기다', () => {
  assert.deepEqual(sttPolicy({ available: true, supportsOnDevice: true, permission: 'granted' }), { kind: 'stt', requiresOnDevice: true });
  assert.deepEqual(sttPolicy({ available: true, supportsOnDevice: false, permission: 'granted' }), { kind: 'typing', reason: 'not_on_device' });
  assert.deepEqual(sttPolicy({ available: true, supportsOnDevice: true, permission: 'denied' }), { kind: 'typing', reason: 'denied' });
  assert.deepEqual(sttPolicy({ available: false, supportsOnDevice: true, permission: 'granted' }), { kind: 'typing', reason: 'unavailable' });
});

test('reading.cast: 이동통신으로 처음 시작하면 용량 확인 팝업이 뜨고 Wi-Fi 나 이미 받은 모델이면 뜨지 않는다', () => {
  const bytes = 398_075_273;
  assert.deepEqual(modelDownloadPrompt({ assetsPresent: false, networkType: 'cellular', bytes }), { ask: true, sizeLabel: '379.6MB' });
  assert.deepEqual(modelDownloadPrompt({ assetsPresent: false, networkType: 'unknown', bytes }), { ask: true, sizeLabel: '379.6MB' });
  assert.deepEqual(modelDownloadPrompt({ assetsPresent: false, networkType: 'wifi', bytes }), { ask: false });
  assert.deepEqual(modelDownloadPrompt({ assetsPresent: true, networkType: 'cellular', bytes }), { ask: false });
});

test('reading.cast: 모델 준비 실패는 자동으로 다른 음성으로 바꾸지 않고 다시 시도·기기 음성·글로 보기 셋을 주며 기본은 글로 보기다', () => {
  assert.deepEqual(VOICE_FAILURE_CHOICES, ['retry', 'device_voice', 'text_only']);
  assert.equal(voiceFallbackDefault(), 'text_only');
});

test('reading.session: 가이드(R03.0)는 기기당 처음 한 번 보여 주고 두 번째 회차에는 나오지 않는다', async () => {
  const items = new Map();
  const storage = { getItem: async (k) => items.get(k) ?? null, setItem: async (k, v) => void items.set(k, v) };
  assert.equal(await hasSeenReadingGuide(storage), false);
  await markReadingGuideSeen(storage);
  assert.equal(await hasSeenReadingGuide(storage), true);
  assert.ok(GUIDE_SEEN_KEY.startsWith('acttub.'));
});
