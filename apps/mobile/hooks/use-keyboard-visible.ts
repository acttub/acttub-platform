import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 소프트 키보드가 떠 있는지.
 *
 * 코치 대화처럼 화면 위쪽을 영상이 차지하는 레이아웃에서, 키보드가 올라오면 무엇을 치고 있는지
 * 안 보이는 문제를 해결하려고 쓴다(키보드가 뜨면 영상을 접는다).
 * iOS는 will* 이벤트가 애니메이션과 같이 시작해 더 부드럽고, Android는 did*만 신뢰할 수 있다.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return visible;
}
