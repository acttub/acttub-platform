import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { setAnalyticsUserId } from '../lib/analytics.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

test('analytics: GA 사용자 ID는 Firebase setUserId 로 붙이고 지운다', () => {
  const lib = read('lib/analytics.ts');
  assert.match(lib, /export async function setAnalyticsUserId\(userId: string \| null\)/);
  assert.match(lib, /mod\.setUserId\(a, userId\)/);
});

test('analytics: 네이티브 모듈이 없는 환경에서는 조용히 no-op 이다', async () => {
  await setAnalyticsUserId('user-1');
  await setAnalyticsUserId(null);
});

test('analytics: Airbridge 와 같은 계정 번호로 붙이고, 지우는 곳마다 GA 사용자 ID도 지운다 — 로그아웃 뒤 다음 사람 기록이 앞 계정에 붙지 않게', () => {
  const auth = read('lib/auth.tsx');
  assert.match(
    auth,
    /const memberId = me\.account_type === 'member' && me\.profile_complete \? me\.id : null;\s*identifySignupAttributionAccount\(memberId\);\s*void setAnalyticsUserId\(memberId\);/,
  );
  const clears = auth.match(/identifySignupAttributionAccount\(null\);/g) ?? [];
  const analyticsClears = auth.match(/identifySignupAttributionAccount\(null\);\s*void setAnalyticsUserId\(null\);/g) ?? [];
  assert.ok(clears.length >= 3);
  assert.equal(analyticsClears.length, clears.length);
});
