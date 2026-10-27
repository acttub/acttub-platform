import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { birthStepOutcome, examDateOk, nextOpenStep, onboardingSteps, stepAfter, stepBefore, stepReady } from '../lib/onboarding-steps.ts';

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

test('stepReady: 칸마다 서버 규칙을 채워야 계속할 수 있다', () => {
  assert.equal(stepReady('name', { ...EMPTY, name: '  ' }, NOW), false);
  assert.equal(stepReady('name', { ...EMPTY, name: '김배우' }, NOW), true);
  assert.equal(stepReady('name', { ...EMPTY, name: '가'.repeat(21) }, NOW), false);
  assert.equal(stepReady('birth', { ...EMPTY, birthDate: '2004-03' }, NOW), false);
  assert.equal(stepReady('birth', { ...EMPTY, birthDate: '2004-03-14' }, NOW), true);
  assert.equal(stepReady('gender', EMPTY, NOW), false);
  assert.equal(stepReady('gender', { ...EMPTY, gender: 'unspecified' }, NOW), true);
  assert.equal(stepReady('directions', { ...EMPTY, directions: ['stage'] }, NOW), true);
  assert.equal(stepReady('discovery', EMPTY, NOW), true);
});

test('birthStepOutcome: 만 14세 미만은 「가입할 수 없어요」, 잘못된 날짜는 칸 오류', () => {
  assert.equal(birthStepOutcome('2004-03-14', NOW), 'next');
  assert.equal(birthStepOutcome('2020-01-01', NOW), 'blocked');
  assert.equal(birthStepOutcome('2004-02-31', NOW), 'invalid');
});

test('가입 게이트는 한 화면에 한 질문 위저드다 — 저장·유입 경로·만 14세 닫힘 처리는 그대로', () => {
  const screen = read('app/profile-name.tsx');
  assert.match(screen, /onboardingSteps\(askDiscovery, form\.experience === 'exam_prep'\)/);
  assert.match(screen, /saveProfile\(buildProfilePayload\(form, now\)\)/);
  assert.match(screen, /api\.recordDiscoveryAnswer\(buildDiscoveryPayload\(answer\)\)/);
  assert.match(screen, /closeAccountUnder14\(\)/);
  assert.match(screen, /logEvent\('profile_setup'/);
  assert.match(screen, /recordSignupCompleted\(me\.id\)/);
});

test('nextOpenStep: 답하면 그 뒤 아직 안 답한 질문으로, 앞 칸을 고친 뒤엔 하던 질문으로 돌아간다(SOMA-790)', () => {
  const steps = onboardingSteps(true);
  assert.equal(nextOpenStep(steps, new Set(), 'name'), 'birth');
  // 성별을 고치러 돌아갔다가 다시 답하면 아직 안 답한 목표로 간다.
  assert.equal(nextOpenStep(steps, new Set(['name', 'birth', 'gender']), 'gender'), 'goal');
  // 앞 칸을 다 답했고 뒤가 남았으면 뒤에서 처음 안 답한 곳.
  assert.equal(nextOpenStep(steps, new Set(['name', 'birth', 'goal']), 'name'), 'gender');
  // 다 답했으면 끝(저장).
  assert.equal(nextOpenStep(steps, new Set(steps), 'directions'), null);
  assert.equal(nextOpenStep(onboardingSteps(false), new Set(['name', 'birth', 'gender', 'goal', 'career']), 'directions'), null);
});

test('입시생이면 경력 뒤에 실기 날짜를 묻고, 날짜는 오늘부터 400일 안만 받는다(SOMA-864)', () => {
  assert.deepEqual(onboardingSteps(false, true), ['name', 'birth', 'gender', 'goal', 'career', 'exam_date', 'directions']);
  assert.deepEqual(onboardingSteps(true), ['name', 'birth', 'gender', 'goal', 'career', 'directions', 'discovery']);
  const now = new Date(2026, 9, 27, 21, 0);
  assert.equal(examDateOk('2026-10-27', now), true);
  assert.equal(examDateOk('2026-10-26', now), false);
  assert.equal(examDateOk('2027-11-30', now), true);
  assert.equal(examDateOk('2027-12-02', now), false);
  assert.equal(examDateOk('2026-02-30', now), false);
  assert.equal(examDateOk('x', now), false);
});
