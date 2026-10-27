import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 숫자 배지 — 디자인 시스템 pen 「Badge」. 높이 20, 최소 폭 20 알약(r-full), 좌우 6, `danger` 바탕 · micro `on-accent`.
 * 글자 수만큼 폭이 늘어나 「99+」가 잘리지 않는다. 글자(99+ 줄임 포함)는 쓰는 쪽이 만든다.
 */
export function Badge({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 20,
    minWidth: 20,
    paddingHorizontal: space[1.5],
    borderRadius: radius.full,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...type.micro, color: palette.onAccent },
});
