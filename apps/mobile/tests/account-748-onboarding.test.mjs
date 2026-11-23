import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { birthStepOutcome, onboardingSteps, stepAfter, stepBefore, stepBlockReason } from '../lib/onboarding-steps.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-19T03:00:00Z');
const EMPTY = { name: '', gender: null, birthDate: '', directions: [], experience: null, goal: null };

test('onboardingSteps: 서버가 받는 여섯 항목을 한 화면에 하나씩, 어디서 알게 됐나는 물을 때만 맨 끝', () => {
  assert.deepEqual(onboardingSteps(true), ['name', 'birth', 'gender', 'goal', 'career', 'directions', 'discovery']);
  assert.deepEqual(onboardingSteps(false), ['name', 'birth', 'gender', 'goal', 'career', 'directions']);
});

test('stepAfter·stepBefore: 끝 다음은 없고(null) 처음 앞은 시작 화면이다', () => {
  const steps = onboardingSteps(false);
  assert.equal(stepAfter(steps, 'name'), 'birth');
  assert.equal(stepAfter(steps, 'directions'), null);
  assert.equal(stepBefore(steps, 'birth'), 'name');
  assert.equal(stepBefore(steps, 'name'), 'intro');
});

test('birthStepOutcome: 만 14세 미만은 「가입할 수 없어요」, 잘못된 날짜는 칸 오류', () => {
  assert.equal(birthStepOutcome('2004-03-14', NOW), 'next');
  assert.equal(birthStepOutcome('2020-01-01', NOW), 'blocked');
  assert.equal(birthStepOutcome('2004-02-31', NOW), 'invalid');
});

test('가입 게이트는 한 화면에 한 질문 위저드다 — 저장·유입 경로·만 14세 닫힘 처리는 그대로', () => {
  const screen = read('app/profile-name.tsx');
  assert.match(screen, /onboardingSteps\(askDiscovery\)/);
  assert.match(screen, /saveProfile\(buildProfilePayload\(form, now\)\)/);
  assert.match(screen, /api\.recordDiscoveryAnswer\(buildDiscoveryPayload\(answer\)\)/);
  assert.match(screen, /closeAccountUnder14\(\)/);
  assert.match(screen, /logEvent\('profile_setup'/);
  assert.match(screen, /recordSignupCompleted\(me\.id\)/);
});

test('stepBlockReason: 못 넘어가는 이유를 칸마다 하나로 말한다(SOMA-1057)', () => {
  assert.equal(stepBlockReason('name', { ...EMPTY, name: '  ' }, NOW), 'name_empty');
  assert.equal(stepBlockReason('name', { ...EMPTY, name: '가'.repeat(21) }, NOW), 'name_too_long');
  assert.equal(stepBlockReason('name', { ...EMPTY, name: '김배우' }, NOW), null);
  assert.equal(stepBlockReason('birth', { ...EMPTY, birthDate: '' }, NOW), 'birth');
  assert.equal(stepBlockReason('birth', { ...EMPTY, birthDate: '2004-02-30' }, NOW), 'birth');
  assert.equal(stepBlockReason('birth', { ...EMPTY, birthDate: '2004-03-14' }, NOW), null);
  assert.equal(stepBlockReason('directions', EMPTY, NOW), 'pick_one');
  assert.equal(stepBlockReason('gender', EMPTY, NOW), 'pick_one');
  assert.equal(stepBlockReason('discovery', EMPTY, NOW), null);
});
