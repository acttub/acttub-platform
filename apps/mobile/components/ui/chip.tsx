import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * pen 「S/Chip」(SOMA-770 공통) — 알약(모서리 끝까지), 흰 바탕 · 1px #E5E8EB 테두리, 안쪽 [11,16], 글자 14/700 #4E5968.
 * 고르면 옅은 파랑 바탕 · 파란 테두리 · 진한 파랑 글자. 감정·필터·답 칩이 같이 쓴다.
 *
 * variant="answer"는 가입 질문의 답 칩(pen 01 가입 「Options」) — 높이 42, 안쪽 좌우 18(`compact`면 16), 글자 15/600 `text`.
 * 고르면 `blueSoft` 바탕 · 1.5 `blue` 테두리 · 15/700 `blue`.
 * 고르는 칩이면 `role`로 radio(하나)·checkbox(여럿)를 알려 화면 읽기가 고른 상태를 읽게 한다.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  phLabel,
  variant = 'default',
  compact = false,
  role = 'button',
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  phLabel?: string;
  variant?: 'default' | 'answer';
  compact?: boolean;
  role?: 'button' | 'radio' | 'checkbox';
  style?: StyleProp<ViewStyle>;
}) {
  const answer = variant === 'answer';
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
      style={({ pressed }) => [
        answer ? styles.answer : styles.chip,
        answer && compact && styles.answerCompact,
        selected && (answer ? styles.answerOn : styles.on),
        pressed && styles.pressed,
        disabled && styles.dim,
        style,
      ]}>
      <Text style={[answer ? styles.answerLabel : styles.label, selected && (answer ? styles.answerLabelOn : styles.labelOn)]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  on: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.5 },
  label: { fontSize: 14, fontWeight: '700', color: palette.textSub },
  labelOn: { color: palette.blueDeep },

  answer: {
    height: 42,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerCompact: { paddingHorizontal: 16 },
  answerOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5 },
  answerLabel: { fontSize: 15, fontWeight: '600', color: palette.text },
  answerLabelOn: { fontWeight: '700', color: palette.blue },
});
