import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 화면을 덮고 있는 소프트 키보드의 높이(px). 안 떠 있으면 0.
 *
 * KeyboardAvoidingView를 쓰지 않는 이유: 안드로이드 edge-to-edge(SDK 54 기본)에서는
 * adjustResize가 창을 줄이지 않고 인셋으로만 알려줘서, KAV의 padding 계산이 어긋나
 * 입력 바가 키보드 뒤로 숨는다(실기기 삼성 기기에서 재현). 키보드 높이를 직접 받아
 * 올릴 만큼만 올리는 쪽이 두 플랫폼 모두에서 예측 가능하다.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
