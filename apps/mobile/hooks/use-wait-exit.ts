import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

/** 기다리는 일을 시작한 탭. 대본 일은 리딩 탭, 코칭 일은 코칭 탭이다. */
export type WaitTab = '/reading' | '/coaching';

/**
 * 기다림 화면의 뒤로 가기(10-27 정함). 머리 뒤로·안드로이드 뒤로 키·밀어서 나가기를 그 일을 시작한 탭의 첫 화면으로 보낸다.
 * 일은 뒤에서 계속된다. 뒤로 가기가 아닌 이동(다 끝나서 넘어가는 replace 등)은 막지 않고 그대로 보낸다.
 * 돌려주는 함수는 화면 안 뒤로 버튼이 같은 길로 나갈 때 부른다.
 * `confirmLeave` 를 주면 뒤로 가기 전에 묻고, false 면 기다림 화면에 남는다(나가면 결과를 다시 찾을 수 없는 일).
 */
export function useWaitExit(waiting: boolean, tab: WaitTab, confirmLeave?: () => Promise<boolean>): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  usePreventRemove(waiting && !leave, ({ data }) => {
    const back = data.action.type === 'GO_BACK' || data.action.type === 'POP';
    if (!back) return setLeave(() => () => navigation.dispatch(data.action));
    leaveToTab();
  });
  // usePreventRemove 는 렌더된 값을 보므로 풀린 값이 그려진 뒤에 움직인다.
  useEffect(() => {
    leave?.();
  }, [leave]);
  function leaveToTab() {
    void (async () => {
      if (confirmLeave && !(await confirmLeave())) return;
      setLeave(() => () => router.dismissTo(tab));
    })();
  }
  return leaveToTab;
}
