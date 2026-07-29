import { forwardRef } from 'react';
import { Platform, ScrollView, type ScrollViewProps } from 'react-native';

/**
 * 글자를 칠 때 키보드가 입력칸을 가리지 않도록 내용을 통째로 밀어 올리는 ScrollView.
 *
 * - iOS: `automaticallyAdjustKeyboardInsets`가 키보드 높이만큼 contentInset을 잡아주고,
 *   포커스된 입력칸까지 자동으로 스크롤한다. (KeyboardAvoidingView보다 헤더 높이 계산이 필요 없다)
 * - Android: `app.json`의 `softwareKeyboardLayoutMode: "resize"`(=adjustResize)로 창 자체가 줄어
 *   포커스된 입력칸이 자동으로 보이는 위치까지 스크롤된다.
 *
 * 두 경우 모두 탭이 키보드에 먹히지 않게 keyboardShouldPersistTaps="handled"를 기본으로 둔다.
 */
export const KeyboardAwareScroll = forwardRef<ScrollView, ScrollViewProps>(
  function KeyboardAwareScroll(props, ref) {
    return (
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        {...props}
      />
    );
  },
);
