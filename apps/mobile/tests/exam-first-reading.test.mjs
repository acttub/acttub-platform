import assert from 'node:assert/strict';
import test from 'node:test';
import { examCountdown } from '../lib/home-sections.ts';
import { setSignupLanding, signupLandingFor, takeSignupLanding } from '../lib/signup-landing.ts';

test('입시생은 가입 직후 입시 예시 대본 고르기로 가고, 한 번 꺼내면 비운다(SOMA-864)', () => {
  assert.equal(signupLandingFor('exam_prep'), '/reading/sample?exam=1');
  for (const v of ['under_1y', null, undefined]) assert.equal(signupLandingFor(v), null);
  setSignupLanding(signupLandingFor('exam_prep'));
  assert.equal(takeSignupLanding(), '/reading/sample?exam=1');
  assert.equal(takeSignupLanding(), null);
});

test('홈 실기 D-day는 입시생이 날짜를 넣었고 오늘~400일 안일 때만', () => {
  const p = (exam_date, experience = 'exam_prep') => ({ experience, exam_date });
  assert.equal(examCountdown(p('2026-11-08'), '2026-10-27'), 12);
  assert.equal(examCountdown(p('2026-10-27'), '2026-10-27'), 0);
  assert.equal(examCountdown(p('2026-10-26'), '2026-10-27'), null);
  assert.equal(examCountdown(p('2026-11-08', 'under_1y'), '2026-10-27'), null);
  assert.equal(examCountdown(p(null), '2026-10-27'), null);
  assert.equal(examCountdown(undefined, '2026-10-27'), null);
});
