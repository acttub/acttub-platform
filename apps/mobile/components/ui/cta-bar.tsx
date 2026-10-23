import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';

/**
 * 화면 아래 고정 버튼 칸 — pen 「C/CtaBar」·각 화면의 「아래」(SOMA-770 공통). 흰 바탕, 위 1px #EDF0F3 줄(`divider`),
 * 안쪽 [12,24,10,24] · 버튼 사이 10. 스크롤 본문 밖(형제)에 두면 내용이 길어도 버튼이 화면 아래에 붙어 있다.
 * 안에는 공통 Button 을 넣는다. 홈 인디케이터만큼 아래를 더 띄운다(`safeBottom`).
 * KeyboardLift 안에서 키보드가 떠 있으면 홈 인디케이터는 키보드 밑이라 띄우지 않는다.
 */
export function CtaBar({
  children,
  divider = false,
  safeBottom = true,
  style,
}: {
  children: ReactNode;
  divider?: boolean;
  safeBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift();
  const keyboardUp = lift !== null && lift > 0;
  return (
    <View style={[styles.bar, divider && styles.divider, safeBottom && !keyboardUp && { paddingBottom: 10 + insets.bottom }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: palette.bg, paddingTop: 12, paddingHorizontal: 24, paddingBottom: 10, gap: 10 },
  divider: { borderTopWidth: 1, borderTopColor: palette.borderSoft },
});
