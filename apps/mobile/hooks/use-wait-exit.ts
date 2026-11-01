import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useRouter } from 'expo-router';

/** 기다리는 일을 시작한 탭. 대본 일은 리딩 탭, 코칭 일은 코칭 탭이다. */
export type WaitTab = '/reading' | '/coaching';

/**
 * 기다림 화면의 뒤로 가기(10-27 정함). 머리 뒤로·안드로이드 뒤로 키·밀어서 나가기를 그 일을 시작한 탭의 첫 화면으로 보낸다.
 * 일은 뒤에서 계속된다. 뒤로 가기가 아닌 이동(다 끝나서 넘어가는 replace, 탭으로 보내는 dismissTo)은 막지 않고 그대로 보낸다.
 * 돌려주는 함수는 화면 안 뒤로 버튼이 같은 길로 나갈 때 부른다.
 * `confirmLeave` 를 주면 뒤로 가기 전에 묻고, false 면 기다림 화면에 남는다(나가면 결과를 다시 찾을 수 없는 일).
 *
 * 나갈 때 막기를 풀지 않는다(SOMA-972). 풀면 native-stack 이 이 화면 머리의 속성을 바꾸고, 그 갱신이 화면 제거와 함께
 * 안드로이드에 닿으면 react-native-screens 가 "ScreenStackFragment added into a non-stack container" 로 앱을 끈다.
 * 막힌 이동은 `data.action` 을 다시 보내면 막기를 지나간다(React Navigation 의 usePreventRemove 사용법).
 */
export function useWaitExit(waiting: boolean, tab: WaitTab, confirmLeave?: () => Promise<boolean>): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  usePreventRemove(waiting, ({ data }) => {
    const back = data.action.type === 'GO_BACK' || data.action.type === 'POP';
    if (back) leaveToTab();
    else navigation.dispatch(data.action);
  });
  function leaveToTab() {
    void (async () => {
      if (confirmLeave && !(await confirmLeave())) return;
      router.dismissTo(tab);
    })();
  }
  return leaveToTab;
}
