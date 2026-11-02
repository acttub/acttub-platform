/**
 * 안드로이드 3버튼 내비게이션 바(||| ○ <) 버튼을 진한 색으로 고정한다 (SOMA-929).
 *
 * 앱 하단바는 흰색인데, 폰이 다크 모드면 안드로이드가 버튼을 연한 회색으로 칠해 거의 안 보였다.
 * app.json의 userInterfaceStyle "light"만으로는 버튼 색이 바뀌지 않아(1.1.0 실기기 확인),
 * 상단 상태바를 <StatusBar style="dark" />로 고정한 것처럼 버튼도 직접 지정한다.
 * 다크 모드 전환·화면 재생성 때 시스템이 되돌릴 수 있어 앱이 다시 활성화될 때마다 한 번 더 건다.
 */
type AppStateLike = {
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void };
};

export function keepDarkNavigationButtons({
  platform,
  setButtonStyle,
  appState,
}: {
  platform: string;
  setButtonStyle: (style: 'dark') => Promise<void> | void;
  appState: AppStateLike;
}): () => void {
  if (platform !== 'android') return () => {};
  const apply = () => {
    try {
      void Promise.resolve(setButtonStyle('dark')).catch(() => {});
    } catch {
      // 버튼 색은 보조 기능이다. 실패해도 앱 흐름을 막지 않는다.
    }
  };
  apply();
  const subscription = appState.addEventListener('change', (next) => {
    if (next === 'active') apply();
  });
  return () => subscription.remove();
}
