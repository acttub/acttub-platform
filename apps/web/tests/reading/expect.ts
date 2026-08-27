/**
 * vitest 흉내 — 리딩 로직 테스트는 rehearsal-web 에서 vitest 로 썼다.
 * 이 앱은 node:test 만 쓰므로 describe/it/expect/vi 를 그 위에 얇게 얹는다.
 * 새 테스트는 이 셈 없이 node:test + assert 로 쓴다.
 */
import assert from "node:assert/strict";
import { mock } from "node:test";

export { afterEach, beforeEach, describe, it } from "node:test";

type MockFn = ((...args: unknown[]) => unknown) & { mock: { calls: { arguments: unknown[] }[] } };

function isMockFn(v: unknown): v is MockFn {
  const m = (v as { mock?: unknown } | null)?.mock;
  return typeof v === "function" && m !== undefined && m !== null && Array.isArray((m as { calls?: unknown }).calls);
}

function matchers(actual: unknown, negate: boolean) {
  const check = (ok: boolean, message: string) => {
    if (negate ? ok : !ok) assert.fail((negate ? "not " : "") + message);
  };
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `expected ${JSON.stringify(actual)} toBe ${JSON.stringify(expected)}`),
    toEqual: (expected: unknown) => {
      let ok = true;
      try {
        assert.deepEqual(actual, expected);
      } catch {
        ok = false;
      }
      check(ok, `expected ${JSON.stringify(actual)} toEqual ${JSON.stringify(expected)}`);
    },
    toMatchObject: (expected: Record<string, unknown>) => {
      const a = actual as Record<string, unknown>;
      let ok = a !== null && typeof a === "object";
      if (ok) {
        for (const [k, v] of Object.entries(expected)) {
          try {
            assert.deepEqual(a[k], v);
          } catch {
            ok = false;
          }
        }
      }
      check(ok, `expected ${JSON.stringify(actual)} toMatchObject ${JSON.stringify(expected)}`);
    },
    toHaveLength: (n: number) => check((actual as { length: number }).length === n, `expected length ${n}, got ${(actual as { length: number }).length}`),
    toBeLessThan: (n: number) => check((actual as number) < n, `expected ${actual} < ${n}`),
    toBeLessThanOrEqual: (n: number) => check((actual as number) <= n, `expected ${actual} <= ${n}`),
    toBeGreaterThan: (n: number) => check((actual as number) > n, `expected ${actual} > ${n}`),
    toBeGreaterThanOrEqual: (n: number) => check((actual as number) >= n, `expected ${actual} >= ${n}`),
    toContain: (item: unknown) =>
      check(
        typeof actual === "string" ? actual.includes(item as string) : (actual as unknown[]).includes(item),
        `expected ${JSON.stringify(actual)} toContain ${JSON.stringify(item)}`,
      ),
    toBeTruthy: () => check(Boolean(actual), `expected truthy, got ${JSON.stringify(actual)}`),
    toBeNull: () => check(actual === null, `expected null, got ${JSON.stringify(actual)}`),
    toBeUndefined: () => check(actual === undefined, `expected undefined, got ${JSON.stringify(actual)}`),
    toHaveBeenCalled: () => {
      assert.ok(isMockFn(actual), "expected a vi.fn()");
      check(actual.mock.calls.length > 0, "expected mock to have been called");
    },
    toHaveBeenCalledTimes: (n: number) => {
      assert.ok(isMockFn(actual), "expected a vi.fn()");
      check(actual.mock.calls.length === n, `expected ${n} calls, got ${actual.mock.calls.length}`);
    },
    toHaveBeenCalledWith: (...args: unknown[]) => {
      assert.ok(isMockFn(actual), "expected a vi.fn()");
      const hit = actual.mock.calls.some((c) => {
        try {
          assert.deepEqual(c.arguments, args);
          return true;
        } catch {
          return false;
        }
      });
      check(hit, `expected mock to have been called with ${JSON.stringify(args)}; calls: ${JSON.stringify(actual.mock.calls.map((c) => c.arguments))}`);
    },
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

// vitest 의 `useFakeTimers({ shouldAdvanceTime: true })` 는 가짜 시계가 실제 시간을 따라 흐른다 —
// 테스트가 `await new Promise(r => setTimeout(r, 0))` 로 한 틱 기다리는 데 그것에 기댄다.
// node 의 mock.timers 는 tick() 을 불러야만 흐르므로, 진짜 setInterval 로 조금씩 밀어 준다.
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
let advancer: ReturnType<typeof realSetInterval> | null = null;
const ADVANCE_STEP_MS = 20;

export const vi = {
  fn: (impl?: (...args: unknown[]) => unknown) => mock.fn(impl ?? (() => undefined)),
  /** 인자(shouldAdvanceTime)는 받아만 둔다 — 여기서는 늘 흐르게 한다. */
  useFakeTimers: (options?: { shouldAdvanceTime?: boolean }) => {
    void options;
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    advancer = realSetInterval(() => mock.timers.tick(ADVANCE_STEP_MS), ADVANCE_STEP_MS);
  },
  useRealTimers: () => {
    if (advancer) realClearInterval(advancer);
    advancer = null;
    mock.timers.reset();
  },
  advanceTimersByTime: (ms: number) => mock.timers.tick(ms),
};
