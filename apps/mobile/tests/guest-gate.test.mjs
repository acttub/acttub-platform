import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBootstrapStep } from '../lib/app-bootstrap.ts';

/**
 * 둘러보기(게스트)가 게이트를 통과하는지 못박는다 (SOMA-544).
 *
 * 이 경로는 한 번 조용히 사라진 적이 있다 — 계정 개편이 게스트를 걷어내면서 버튼도 상태도
 * 같이 없어졌는데, 화면은 멀쩡히 뜨고 테스트도 다 통과해서 아무도 몰랐다. 로그인 없이
 * 둘러볼 수 있다는 약속은 화면 하나가 아니라 게이트의 성질이므로 여기서 지킨다.
 */

/** 게스트에게는 계정이 없다 — 동의·프로필은 계정을 만들 때 받는 값이라 비어 있다. */
const guest = {
  authStatus: 'guest',
  userId: null,
  consentEntryStatus: 'checking',
  profileStatus: 'checking',
  recoveryStatus: 'loading',
  recoveryOwner: null,
  pending: null,
};

test('둘러보는 사람은 동의·프로필을 거치지 않고 바로 탭으로 간다', () => {
  assert.deepEqual(resolveBootstrapStep(guest), { stage: 'done', route: '/(tabs)' });
});

test('계정이 없다고 로그인 화면으로 보내지 않는다', () => {
  const step = resolveBootstrapStep(guest);
  assert.notEqual(step.route, '/login');
  assert.notEqual(step.route, '/consent');
});

test('동의나 프로필이 어떤 값이든 둘러보기는 막히지 않는다', () => {
  for (const consentEntryStatus of ['checking', 'error', 'decision_required', 'allowed']) {
    for (const profileStatus of ['checking', 'error', 'required', 'complete']) {
      assert.deepEqual(
        resolveBootstrapStep({ ...guest, consentEntryStatus, profileStatus }),
        { stage: 'done', route: '/(tabs)' },
        `consent=${consentEntryStatus} profile=${profileStatus}`,
      );
    }
  }
});

test('업데이트가 필요한 빌드는 둘러보기보다 먼저 막는다', () => {
  assert.deepEqual(
    resolveBootstrapStep({ ...guest, updateRequired: true }),
    { stage: 'update-gate', route: '/update-required' },
  );
});

test('로그인한 사람은 여전히 동의·프로필을 거친다 — 게스트 통로가 새지 않는다', () => {
  const signedIn = { ...guest, authStatus: 'signedIn', userId: 'user-1' };
  assert.deepEqual(
    resolveBootstrapStep({ ...signedIn, consentEntryStatus: 'decision_required' }),
    { stage: 'consent-gate', route: '/consent' },
  );
  assert.deepEqual(
    resolveBootstrapStep({ ...signedIn, consentEntryStatus: 'allowed', profileStatus: 'required' }),
    { stage: 'profile-gate', route: '/profile-name' },
  );
});
