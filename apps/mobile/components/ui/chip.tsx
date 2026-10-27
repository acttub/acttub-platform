import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「Chip/Off」·「Chip/On」 — 높이 40 알약, 흰 바탕 · 1px border, 안쪽 좌우 16, body2-bold text-sub.
 * 고르면 blue-soft 바탕 · 1.5px blue 테두리 · blue-deep 글자. 감정·필터·답 칩이 같이 쓴다.
 * 고르는 칩이면 `role`로 radio(하나)·checkbox(여럿)를 알려 화면 읽기가 고른 상태를 읽게 한다.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  phLabel,
  role = 'button',
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  phLabel?: string;
  role?: 'button' | 'radio' | 'checkbox';
  style?: StyleProp<ViewStyle>;
}) {
  const state =
    role === 'checkbox'
      ? { checked: selected, disabled: !!disabled }
      : { selected, disabled: !!disabled };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={state}
      ph-label={phLabel}
      style={({ pressed }) => [styles.chip, selected && styles.on, pressed && styles.pressed, disabled && styles.dim, style]}>
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 40,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: space[4],
  },
  on: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5 },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  label: { ...type.body2Bold, color: palette.textSub },
  labelOn: { color: palette.blueDeep },
});
