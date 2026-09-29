import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_CLOUD_VOICE_PROMO, koreaDay, parseCloudVoicePromoState, shouldShowCloudVoicePromo } from '../lib/cloud-voice-promo.ts';

const now = Date.parse('2026-10-01T12:00:00+09:00');
const base = { loggedIn: true, available: true, consent: 'undecided', enabled: false, freeUntil: '2026-11-30T23:59:59+09:00', promo: EMPTY_CLOUD_VOICE_PROMO, today: koreaDay(now), now, otherModalOpen: false, onboardingJustFinished: false };

test('프로모션은 로그인·가용 기간·미사용 조건에서 표시한다', () => assert.equal(shouldShowCloudVoicePromo(base), true));
test('프로모션은 하루 한 번이며 영구 숨김을 지킨다', () => {
  assert.equal(shouldShowCloudVoicePromo({ ...base, promo: { dismissedForever: false, lastShownDay: base.today } }), false);
  assert.equal(shouldShowCloudVoicePromo({ ...base, promo: { dismissedForever: true, lastShownDay: null } }), false);
});
test('프로모션은 기간 밖·가용하지 않음·이미 켬·다른 모달·온보딩 직후에는 숨긴다', () => {
  assert.equal(shouldShowCloudVoicePromo({ ...base, now: Date.parse('2026-12-01T00:00:00+09:00') }), false);
  assert.equal(shouldShowCloudVoicePromo({ ...base, available: false }), false);
  assert.equal(shouldShowCloudVoicePromo({ ...base, enabled: true, consent: 'granted' }), false);
  assert.equal(shouldShowCloudVoicePromo({ ...base, otherModalOpen: true }), false);
  assert.equal(shouldShowCloudVoicePromo({ ...base, onboardingJustFinished: true }), false);
});
test('깨진 프로모션 저장값은 안전한 기본값으로 읽는다', () => assert.deepEqual(parseCloudVoicePromoState('{'), EMPTY_CLOUD_VOICE_PROMO));
