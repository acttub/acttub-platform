import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldStopCloudVoiceForSession,
  shouldUseCloudVoice,
} from '../lib/reading/cloud-voice.ts';
import { speechKey } from '../lib/reading/tts/speech-key.ts';

const status = { available: true, consent: 'granted', daily_limit: 300, daily_used: 12, free_until: '2026-11-30T23:59:59+09:00' };

test('고품질 목소리는 설정·가용성·동의·일일 잔여량이 모두 있을 때만 쓴다', () => {
  assert.equal(shouldUseCloudVoice({ enabled: true, status }), true);
  assert.equal(shouldUseCloudVoice({ enabled: false, status }), false);
  assert.equal(shouldUseCloudVoice({ enabled: true, status: { ...status, available: false } }), false);
  assert.equal(shouldUseCloudVoice({ enabled: true, status: { ...status, consent: 'undecided' } }), false);
  assert.equal(shouldUseCloudVoice({ enabled: true, status: { ...status, daily_used: 300 } }), false);
});

test('429와 503은 남은 회차 클라우드 요청을 막고 다른 실패는 해당 줄만 폴백한다', () => {
  assert.equal(shouldStopCloudVoiceForSession({ status: 429 }), true);
  assert.equal(shouldStopCloudVoiceForSession({ status: 503 }), true);
  assert.equal(shouldStopCloudVoiceForSession({ status: 500 }), false);
});

test('클라우드와 기기 음성 캐시 키는 같은 대사여도 섞이지 않는다', () => {
  const base = { text: '여기 있을 줄 알았어.', locale: 'ko', preset: 'F1', variant: 'fp32', steps: 8, speed: 1 };
  assert.notEqual(speechKey({ ...base, source: 'device' }), speechKey({ ...base, source: 'cloud' }));
});

test('고품질 목소리 키는 WAV를 두 번 싸던 0.1.2 첫 판의 파일을 다시 쓰지 않는다', () => {
  const base = { text: '여기 있을 줄 알았어.', locale: 'ko', preset: 'F1', variant: 'fp32', steps: 8, speed: 1 };
  // 그 판의 키는 원문 끝에 'cloud'를 붙여 지었다 — 기기 키 원문 끝에 ' cloud'를 덧대면 똑같이 나온다.
  const firstRelease = speechKey({ ...base, speed: '1 cloud', source: 'device' });
  assert.notEqual(speechKey({ ...base, source: 'cloud' }), firstRelease);
});

test('consentBodyWithoutTitle: 시트가 제목을 따로 보여 주므로 문서 첫 줄의 # 제목은 뗀다', async () => {
  const { consentBodyWithoutTitle } = await import('../lib/reading/cloud-voice.ts');
  assert.equal(consentBodyWithoutTitle('# 대본 리딩 고품질 목소리 동의 (선택)\n\n시행일: 오늘\n\n## 1. 무엇'), '시행일: 오늘\n\n## 1. 무엇');
  assert.equal(consentBodyWithoutTitle('시행일: 오늘'), '시행일: 오늘');
  assert.equal(consentBodyWithoutTitle('## 소제목은 남긴다'), '## 소제목은 남긴다');
});
