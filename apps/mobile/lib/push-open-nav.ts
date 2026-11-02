/**
 * 알림을 눌러 화면을 열 때 그 아래에 홈을 깐다(11/2 폰 QA).
 *
 * 전에는 알림이 말한 화면으로 router.replace 만 했다. 앱이 켜져 있던 탭 화면이 그 자리에서 바뀌어
 * 스택에 화면이 하나만 남고, 안드로이드 뒤로가기를 누르면 앱이 닫혔다. 이제는 쌓인 화면을 걷고
 * 홈으로 간 뒤 그 위에 대상 화면을 올린다. 뒤로가기는 홈으로 온다.
 * 대상이 탭(홈·리딩)이면 그 탭으로만 간다.
 */
export type PushOpenRouter = {
  replace: (href: string) => void;
  push: (href: string) => void;
  dismissAll?: () => void;
  canDismiss?: () => boolean;
};

const TAB_TARGETS = new Set(['/(tabs)', '/reading', '/(tabs)/reading']);

export function openPushTarget(router: PushOpenRouter, target: string): void {
  if (router.canDismiss?.()) router.dismissAll?.();
  if (TAB_TARGETS.has(target)) {
    router.replace(target);
    return;
  }
  router.replace('/(tabs)');
  router.push(target);
}
