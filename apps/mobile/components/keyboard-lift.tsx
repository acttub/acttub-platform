import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dimensions, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

/** 안쪽에서 키보드 때문에 비운 높이. KeyboardLift 밖이면 null. */
const KeyboardLiftContext = createContext<number | null>(null);

export function useKeyboardLift(): number | null {
  return useContext(KeyboardLiftContext);
}

/**
 * 키보드가 뜨면 키보드가 덮는 만큼 아래를 비워, 안의 내용과 아래 고정 버튼(CtaBar·입력 줄)이 키보드 위로 올라오게 한다.
 * iOS·안드로이드 같은 방식이다 — iOS의 automaticallyAdjustKeyboardInsets는 스크롤 안쪽만 밀어서 스크롤 밖 CtaBar가
 * 키보드 뒤에 남았고(10/24 iOS 제보), 안드로이드 edge-to-edge는 창이 줄지 않았다([[use-keyboard-height]]).
 *
 * 이 칸 아래에 SafeArea 여백 같은 다른 칸이 있으면 그만큼은 덜 비운다 — 화면 바닥에서 이 칸까지의 거리를 재서 뺀다.
 * `extra`는 키보드 위에 더 띄울 간격(가운데 팝업이 키보드에 붙지 않게).
 */
export function KeyboardLift({
  children,
  style,
  extra = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  extra?: number;
}) {
  const keyboard = useKeyboardHeight();
  const ref = useRef<View>(null);
  const [below, setBelow] = useState(0);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => {
      const screen = Dimensions.get('screen').height;
      if (!Number.isFinite(y) || !Number.isFinite(h) || screen <= 0) return;
      setBelow(Math.max(0, Math.round(screen - (y + h))));
    });
  }, []);
  const lift = keyboard > 0 ? Math.max(0, keyboard - below) + extra : 0;
  return (
    <KeyboardLiftContext.Provider value={lift}>
      <View ref={ref} onLayout={measure} style={[styles.fill, style, lift > 0 && { paddingBottom: lift }]}>
        {children}
      </View>
    </KeyboardLiftContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
