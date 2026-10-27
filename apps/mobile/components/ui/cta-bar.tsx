import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';

/**
 * 아래 고정 바 — 디자인 시스템 pen 「BottomCTA」. 흰 바탕, 위 구분선 없음, 안쪽 위 12 · 좌우 20 · 아래 안전영역+12, 버튼 사이 8.
 * 보조 글자 버튼은 주 버튼 바로 위, 주 버튼이 맨 아래다(회원 탈퇴만 반대). 스크롤 본문 밖(형제)에 두면 내용이 길어도 화면 아래에 붙는다.
 * KeyboardLift 안에서 키보드가 떠 있으면 홈 인디케이터는 키보드 밑이라 띄우지 않는다.
 */
export function CtaBar({
  children,
  safeBottom = true,
  style,
}: {
  children: ReactNode;
  safeBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift();
  const keyboardUp = lift !== null && lift > 0;
  return (
    <View style={[styles.bar, safeBottom && !keyboardUp && { paddingBottom: space[3] + insets.bottom }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: palette.bg, paddingTop: space[3], paddingHorizontal: space.gutter, paddingBottom: space[3], gap: space[2] },
});
