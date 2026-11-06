import Feather from '@expo/vector-icons/Feather';
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, shadowOverlay, space, type } from '@/constants/tokens';

/**
 * 목록 화면의 「추가」 전용 — 디자인 시스템 pen 「FloatingButton/Add」. 높이 48, r-full, 오른쪽 20, blue, 아이콘 20 + body1-bold,
 * shadow-overlay. `bottom`은 탭바 위 12(탭바가 없으면 안전영역+12). 목록 맨 아래에 가리지 않을 여백은 쓰는 쪽이 둔다.
 */
export function FloatingAdd({
  label,
  bottom,
  onPress,
  phLabel,
  target,
}: {
  label: string;
  bottom: number;
  onPress: () => void;
  phLabel: string;
  target?: { ref: Ref<View>; onLayout: (e: LayoutChangeEvent) => void };
}) {
  return (
    <View style={[styles.wrap, { bottom }]} ref={target?.ref} onLayout={target?.onLayout}>
      <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} ph-label={phLabel}>
        <Feather name="plus" size={20} color={palette.onAccent} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

export const FLOATING_ADD_HEIGHT = 48;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space.gutter },
  button: {
    height: FLOATING_ADD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    backgroundColor: palette.blue,
    ...shadowOverlay,
  },
  pressed: { opacity: 0.85 },
  label: { ...type.body1Bold, color: palette.onAccent },
});
