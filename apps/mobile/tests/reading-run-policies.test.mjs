import assert from 'node:assert/strict';
import test from 'node:test';

import { sttPolicy } from '../lib/reading/stt-policy.ts';
import { modelDownloadPrompt } from '../lib/reading/voice-policy.ts';
import { AUTO_ADVANCE_TIP_KEY, hideAutoAdvanceTip, isAutoAdvanceTipHidden } from '../lib/reading/guide-flag.ts';
import {
  APP_VOICE_UNSUPPORTED_KEY,
  MODEL_LOAD_STARTED_KEY,
  choosePartnerVoice,
  markAppVoiceNoticed,
  markAppVoiceUnsupported,
  markModelLoadEnded,
  markModelLoadStarted,
  readAppVoiceSupport,
  voiceSupportsLocale,
} from '../lib/reading/voice-capability.ts';

function memoryStorage() {
  const items = new Map();
  return {
    items,
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => void items.set(k, v),
    removeItem: async (k) => void items.delete(k),
  };
}

test('reading.session: 플랫폼 STT는 기기 안 처리를 보장할 때만 켜고 아니면 대조하지 않는다', () => {
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

test('reading.session: 자동 넘김 안내 팝업(R9.8)은 「다시 보지 않기」 전까지 회차마다 뜬다', async () => {
  const storage = memoryStorage();
  assert.equal(await isAutoAdvanceTipHidden(storage), false);
  assert.equal(await isAutoAdvanceTipHidden(storage), false, '[확인]은 아무것도 남기지 않아 다음 회차에도 뜬다');
  await hideAutoAdvanceTip(storage);
  assert.equal(await isAutoAdvanceTipHidden(storage), true);
  assert.equal(storage.items.get(AUTO_ADVANCE_TIP_KEY), '1');
  assert.ok(AUTO_ADVANCE_TIP_KEY.startsWith('acttub.'));
});

test('reading.cast: 앱 목소리를 못 쓰는 기기 — 불러오기 실패를 기억하고 안내는 한 번만', async () => {
  const storage = memoryStorage();
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: false });
  await markAppVoiceUnsupported(storage);
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: true, noticed: false });
  await markAppVoiceNoticed(storage);
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: true, noticed: true });
  assert.equal(storage.items.get(APP_VOICE_UNSUPPORTED_KEY), 'noticed');
});

test('reading.cast: 불러오기 시작 표시만 남은 채 앱이 다시 켜지면 꺼진 것으로 보고 못 쓰는 기기로 굳힌다', async () => {
  const storage = memoryStorage();
  await markModelLoadStarted(storage);
  await markModelLoadEnded(storage);
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: false }, '끝 표시까지 났으면 멀쩡하다');
  await markModelLoadStarted(storage);
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: true, noticed: false });
  assert.equal(storage.items.has(MODEL_LOAD_STARTED_KEY), false, '시작 표시는 굳히며 지운다');
  assert.deepEqual(await readAppVoiceSupport(storage), { unsupported: true, noticed: false }, '그 뒤로는 표시만 읽는다');
});

test('reading.cast: 상대 목소리는 고품질 → 앱 목소리 → 기기 기본 목소리 → 글로 보기 순이다', () => {
  assert.equal(choosePartnerVoice({ cloud: true, appVoice: true, deviceVoice: true }), 'cloud');
  assert.equal(choosePartnerVoice({ cloud: false, appVoice: true, deviceVoice: true }), 'supertonic');
  assert.equal(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice: true }), 'device_voice');
  assert.equal(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice: false }), 'text_only');
});

test('reading.cast: 기기 음성은 말의 첫 조각으로 맞추고 빈 목록은 있는 것으로 본다', () => {
  assert.equal(voiceSupportsLocale([{ language: 'ko-KR' }, { language: 'en-US' }], 'ko-KR'), true);
  assert.equal(voiceSupportsLocale([{ language: 'ko_KR' }], 'ko-KR'), true);
  assert.equal(voiceSupportsLocale([{ language: 'en-US' }, { language: 'ja-JP' }], 'ko-KR'), false);
  assert.equal(voiceSupportsLocale([], 'ko-KR'), true);
});
