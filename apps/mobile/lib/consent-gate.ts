/**
 * 동의 게이트(서버 ConsentGateInterceptor)에 막힐 요청을 판정이 끝난 동안 붙잡아 둔다(SOMA-1155).
 *
 * 동의 진입 판정이 '동의 필요'로 나오면 닫고, 'allowed' 가 되면 연다. 닫힌 동안 게이트 안 경로의 인증 요청은
 * 보내지 않고 기다렸다가, 열리는 순간 그대로 나간다 — 동의 직후 홈·미리 받기가 바로 이어진다. 판정 전과
 * allowed 에서는 열려 있어 이미 동의한 회원의 시작은 한 왕복도 늦어지지 않는다.
 */

type GateRule = readonly [method: string | null, pattern: string];

/**
 * 서버가 동의 없이 받는 경로. apps/api ConsentGateInterceptor.OUTSIDE_THE_GATE 와 같다. null 은 모든 메서드,
 * '/**' 는 그 경로와 하위 전부다. /v2/ 밖의 경로는 게이트가 없다.
 */
const OUTSIDE_THE_GATE: readonly GateRule[] = [
  [null, '/v2/auth/**'],
  [null, '/v2/consents/**'],
  ['GET', '/v2/me'],
  ['DELETE', '/v2/me'],
  ['DELETE', '/v2/push-tokens'],
  ['POST', '/v2/push-opens'],
  [null, '/v2/admissions/**'],
  ['GET', '/v2/auditions'],
  ['GET', '/v2/app/config'],
  ['GET', '/v2/public/**'],
  ['POST', '/v2/support/inquiries'],
  ['GET', '/v2/blog/**'],
  [null, '/v2/admin/**'],
  [null, '/v2/pg-review/**'],
  ['GET', '/v2/billing/web/**'],
  [null, '/v2/billing/store-notify/**'],
];

function matches(pattern: string, path: string): boolean {
  if (!pattern.endsWith('/**')) return path === pattern;
  const base = pattern.slice(0, -3);
  return path === base || path.startsWith(`${base}/`);
}

export function isOutsideConsentGate(method: string, path: string): boolean {
  const bare = path.split(/[?#]/, 1)[0];
  if (!bare.startsWith('/v2/')) return true;
  const upper = method.toUpperCase();
  return OUTSIDE_THE_GATE.some(
    ([ruleMethod, pattern]) => (ruleMethod === null || ruleMethod === upper) && matches(pattern, bare),
  );
}

export function createConsentGate() {
  let closed = false;
  let waiters: (() => void)[] = [];

  function close(): void {
    closed = true;
  }

  function open(): void {
    closed = false;
    const released = waiters;
    waiters = [];
    for (const release of released) release();
  }

  /** 막힐 요청이면 열릴 때까지 기다릴 약속, 지금 보내도 되면 null. */
  function waitFor(method: string, path: string): Promise<void> | null {
    if (!closed || isOutsideConsentGate(method, path)) return null;
    return new Promise<void>((resolve) => waiters.push(resolve));
  }

  return { close, open, waitFor, isClosed: () => closed };
}

/** 앱 전체가 쓰는 하나. lib/auth.tsx 가 판정에 맞춰 열고 닫고, lib/api.ts 의 요청 계층이 기다린다. */
export const consentGate = createConsentGate();
