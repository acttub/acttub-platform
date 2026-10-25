import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, ScrollView, TextInput, View, type ScrollViewProps } from 'react-native';

import { useKeyboardLift } from '@/components/keyboard-lift';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

/** 입력칸 아래로 남길 간격 — 칸 바로 밑 글자 수·오류 줄까지 보이게. */
const REVEAL_GAP = 24;

/**
 * 글자를 칠 때 키보드가 입력칸을 가리지 않도록 내용을 밀어 올리는 ScrollView.
 *
 * - KeyboardLift 안: 바깥이 키보드만큼 줄어든다. 줄어든 뒤 지금 입력칸이 보이는 자리로 직접 스크롤한다.
 *   iOS 자동 인셋은 끈다 — 켜 두면 줄어든 칸에 키보드 높이를 한 번 더 비운다.
 * - KeyboardLift 밖: iOS는 `automaticallyAdjustKeyboardInsets`가 맡고, 안드로이드는 edge-to-edge에서 창이 줄지 않아
 *   내용 아래를 키보드만큼 비우고 입력칸까지 스크롤한다.
 *
 * 탭이 키보드에 먹히지 않게 keyboardShouldPersistTaps="handled"를 기본으로 둔다.
 */
export const KeyboardAwareScroll = forwardRef<ScrollView, ScrollViewProps>(
  function KeyboardAwareScroll({ onLayout, onScroll, contentContainerStyle, ...props }, ref) {
    const lift = useKeyboardLift();
    const keyboard = useKeyboardHeight();
    const inner = useRef<ScrollView>(null);
    const viewport = useRef(0);
    const offset = useRef(0);
    useImperativeHandle(ref, () => inner.current as ScrollView, []);

    const lifted = lift !== null;
    const androidPad = !lifted && Platform.OS === 'android' ? keyboard : 0;
    const open = lifted ? lift > 0 : Platform.OS === 'android' && keyboard > 0;

    const reveal = useCallback(() => {
      const scroll = inner.current;
      const input = TextInput.State.currentlyFocusedInput?.();
      // getInnerViewRef는 RN 0.81 런타임에 있지만 .d.ts에 빠져 있다.
      const content = (scroll as (ScrollView & { getInnerViewRef?: () => View | null }) | null)?.getInnerViewRef?.();
      if (!scroll || !input || !content || viewport.current <= 0) return;
      // 실제 보이는 높이 — 밖에서 줄지 않는 경우(안드로이드, KeyboardLift 밖)는 키보드만큼 덜 보인다.
      const visible = viewport.current - androidPad;
      input.measureLayout(
        content,
        (_x, y, _w, h) => {
          const top = offset.current;
          if (y + h + REVEAL_GAP > top + visible) {
            scroll.scrollTo({ y: Math.max(0, y + h + REVEAL_GAP - visible), animated: true });
          } else if (y < top) {
            scroll.scrollTo({ y: Math.max(0, y - REVEAL_GAP), animated: true });
          }
        },
        () => undefined,
      );
    }, [androidPad]);

    useEffect(() => {
      if (!open) return;
      // 바깥이 줄어든 뒤(다음 그리기) 잰다.
      const timer = setTimeout(reveal, Platform.OS === 'ios' ? 280 : 120);
      return () => clearTimeout(timer);
    }, [open, reveal]);

    return (
      <ScrollView
        ref={inner}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && !lifted}
        scrollEventThrottle={16}
        {...props}
        contentContainerStyle={[contentContainerStyle, androidPad > 0 && { paddingBottom: androidPad }]}
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.height;
          onLayout?.(event);
        }}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
          onScroll?.(event);
        }}
      />
    );
  },
);
