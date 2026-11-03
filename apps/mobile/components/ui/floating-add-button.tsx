import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { radius, shadowOverlay, space, type } from '@/constants/tokens';

/** 디자인 시스템 FloatingButton/Add — 목록 화면의 「추가」 전용. 높이 48 · r-full · 오른쪽 20, 탭바 없으면 안전영역+12. */
export function FloatingAddButton({ label, onPress, phLabel }: { label: string; onPress: () => void; phLabel: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      ph-label={phLabel}
      style={({ pressed }) => [styles.button, { bottom: insets.bottom + space[3] }, pressed && styles.pressed]}>
      <Feather name="plus" size={20} color={palette.onAccent} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: space.gutter,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    backgroundColor: palette.blue,
    ...shadowOverlay,
  },
  pressed: { opacity: 0.85 },
  label: { ...type.body2Bold, color: palette.onAccent },
});
