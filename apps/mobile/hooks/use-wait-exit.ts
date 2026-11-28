import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';

/** 기다리는 일을 시작한 탭. 대본 일은 리딩 탭, 코칭 일은 코칭 탭이다. */
export type WaitTab = '/reading' | '/coaching';

/**
 * 기다림 화면의 뒤로 가기(10-27 정함). 머리 뒤로·안드로이드 뒤로 키·밀어서 나가기를 그 일을 시작한 탭의 첫 화면으로 보낸다.
 * 일은 뒤에서 계속된다. 뒤로 가기가 아닌 이동(다 끝나서 넘어가는 replace, 탭으로 보내는 dismissTo)은 막지 않고 그대로 보낸다.
 * 돌려주는 함수는 화면 안 뒤로 버튼이 같은 길로 나갈 때 부른다.
 * `confirmLeave` 를 주면 뒤로 가기 전에 묻고, false 면 기다림 화면에 남는다(나가면 결과를 다시 찾을 수 없는 일).
 *
 * 막힌 이동은 `repeat` 로 이어 간다(expo-router SDK 58). SDK 58 은 막기를 켠 채 `data.action` 을 다시 보내면 또 막아
 * 콜백이 끝없이 돈다. `repeat` 는 이 화면의 막기를 풀고 같은 이동을 보낸다. 그래서 화면이 내려가기 전에 머리 속성
 * (preventNativeDismiss)이 한 번 바뀐다. SOMA-972 때는 이 순서에서 안드로이드 react-native-screens 4.16 이
 * "ScreenStackFragment added into a non-stack container" 로 앱을 껐다. 4.30 에서 다시 나는지는 실기기로 본다.
 */
export function useWaitExit(
  waiting: boolean,
  tab: WaitTab,
  confirmLeave?: () => Promise<boolean>,
  /** 바로 아래가 탭 화면이면 그 탭으로 돌아간다(하던 코칭을 프로필·홈에서 바로 연 경우, 11/2 QA). 기본은 일을 시작한 탭. */
  options?: { backToTabBelow?: boolean },
): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  usePreventRemove(waiting, ({ data, repeat }) => {
    const back = data.action.type === 'GO_BACK' || data.action.type === 'POP';
    if (back) leaveToTab(repeat);
    else repeat();
  });
  // backToTabBelow 이고 바로 아래가 탭 화면이면(프로필·홈에서 하던 코칭을 바로 연 경우) 그 탭으로 그냥 돌아간다 — 코칭 탭으로
  // 보내면 들어온 곳이 아닌 데로 가 어색했다(11/2 QA). 중간 화면(올리기 등)을 거쳐 왔으면 일을 시작한 탭으로 보낸다.
  function belowIsTabs(): boolean {
    if (!options?.backToTabBelow) return false;
    const state = typeof navigation.getState === 'function' ? navigation.getState() : undefined;
    if (!state) return false;
    return state.routes[state.index - 1]?.name === '(tabs)';
  }
  function leaveToTab(goBack?: () => void) {
    void (async () => {
      if (confirmLeave && !(await confirmLeave())) return;
      if (belowIsTabs()) {
        if (goBack) goBack();
        else router.back();
        return;
      }
      router.dismissTo(tab);
    })();
  }
  return () => leaveToTab();
}
