import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

import { keyboardOverlap } from '@/lib/keyboard-overlap';

/**
 * 화면 아래에서 키보드가 실제로 덮는 높이(px). 안 떠 있으면 0.
 *
 * KeyboardAvoidingView를 쓰지 않는 이유: 안드로이드 edge-to-edge(SDK 54 기본)에서는
 * adjustResize가 창을 줄이지 않고 인셋으로만 알려줘서, KAV의 padding 계산이 어긋나
 * 입력 바가 키보드 뒤로 숨는다. 키보드 높이를 직접 받아 올릴 만큼만 올린다.
 *
 * 높이는 endCoordinates.height를 그대로 믿지 않고 화면 좌표로도 재서 큰 쪽을 쓴다
 * ([[keyboard-overlap]]) — 기기·네비게이션 방식에 따라 보고 값이 시스템 바를 빼먹는다.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      // screen(전체 화면) 기준이어야 endCoordinates.screenY와 같은 좌표계가 된다.
      const screenHeight = Dimensions.get('screen').height;
      setHeight(keyboardOverlap(event.endCoordinates, screenHeight));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
