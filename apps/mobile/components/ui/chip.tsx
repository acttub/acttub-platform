import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * pen 「S/Chip」(SOMA-770 공통) — 알약(모서리 끝까지), 흰 바탕 · 1px #E5E8EB 테두리, 안쪽 [11,16], 글자 14/700 #4E5968.
 * 고르면 옅은 파랑 바탕 · 파란 테두리 · 진한 파랑 글자. 성별·감정·필터·답 칩이 같이 쓴다.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  phLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  phLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.chip, selected && styles.on, pressed && styles.pressed, disabled && styles.dim]}>
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  on: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  label: { fontSize: 14, fontWeight: '700', color: palette.textDim },
  labelOn: { color: palette.blueDeep },
});
