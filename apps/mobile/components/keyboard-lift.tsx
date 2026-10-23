import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * `aboveSafeBottom` — 이 칸 아래에 SafeAreaView 아래 여백(홈 인디케이터·안드로이드 내비 바)이 이미 있으면 켠다. 그만큼은
 * 덜 비운다. 예전엔 화면 좌표를 재서 뺐는데, 안드로이드에서 창 좌표가 상태 표시줄만큼 어긋나 버튼이 반쯤 가렸다(10/24 폰).
 * `extra`는 키보드 위에 더 띄울 간격.
 */
export function KeyboardLift({
  children,
  style,
  aboveSafeBottom = false,
  extra = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  aboveSafeBottom?: boolean;
  extra?: number;
}) {
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const below = aboveSafeBottom ? insets.bottom : 0;
  const lift = keyboard > 0 ? Math.max(0, keyboard - below) + extra : 0;
  return (
    <KeyboardLiftContext.Provider value={lift}>
      <View style={[styles.fill, style, lift > 0 && { paddingBottom: lift }]}>{children}</View>
    </KeyboardLiftContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
