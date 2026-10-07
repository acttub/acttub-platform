/**
 * 버튼을 연달아 누르면 같은 화면이 여러 번 쌓이는 것을 막는다(SOMA-594). expo-router 의 `useRouter()` 는 앱 전체에
 * 하나뿐인 `router` 객체를 돌려주므로, 루트 레이아웃에서 그 객체를 한 번 감싸면 모든 화면 이동에 걸린다.
 *
 * - push·navigate·replace: 같은 방식으로 같은 화면(경로+params)에 가는 호출이 창 안에 다시 오면 버린다.
 *   다른 화면으로 이어 가는 호출(push 뒤 replace 등)은 막지 않는다.
 * - back: 창 안에 다시 오면 버린다 — 두 번 눌러 두 화면이 닫히지 않게.
 */
export const SAME_TARGET_WINDOW_MS = 800;
export const BACK_WINDOW_MS = 400;

type AnyFn = (...args: any[]) => any;
type GuardableRouter = { push: AnyFn; navigate: AnyFn; replace: AnyFn; back: AnyFn };

const INSTALLED = Symbol.for('acttub.navigationGuard');

function targetKey(href: unknown): string {
  if (typeof href === 'string') return href;
  try {
    return JSON.stringify(href);
  } catch {
    return String(href);
  }
}

export function installNavigationGuard(router: GuardableRouter, now: () => number = Date.now): void {
  const marked = router as GuardableRouter & { [INSTALLED]?: boolean };
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  let last: { key: string; at: number } | null = null;
  for (const method of ['push', 'navigate', 'replace'] as const) {
    const original = router[method];
    router[method] = (href: unknown, ...rest: unknown[]) => {
      const key = `${method} ${targetKey(href)}`;
      const at = now();
      if (last && last.key === key && at - last.at < SAME_TARGET_WINDOW_MS) return;
      last = { key, at };
      return original(href, ...rest);
    };
  }

  let lastBack = -Infinity;
  const back = router.back;
  router.back = (...args: unknown[]) => {
    const at = now();
    if (at - lastBack < BACK_WINDOW_MS) return;
    lastBack = at;
    return back(...args);
  };
}
