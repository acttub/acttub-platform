import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 글자 앞 아이콘. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** PostHog 누름 이름(ph-label). */
  phLabel?: string;
};

/**
 * 앱의 기본 버튼 하나 — pen 「버튼 / Primary」(파이프라인 반영버전). 높이 48, 모서리 16, 글자 17/700.
 * primary: 파랑 #4880EE · 흰 글자 / secondary: #F2F4F6 · #4E5968 / danger: 빨강 · 흰 글자.
 * 막혀 있으면 어느 모양이든 Disabled(#E5E8EB 바탕 · #B0B8C1 글자)로 바뀐다. 모든 화면의 큰 버튼은 이것만 쓴다.
 */
export function Button({
  label,
  onPress,
  disabled,
  loading,
  icon,
  style,
  accessibilityLabel,
  phLabel,
  variant = 'primary',
}: ButtonProps & { variant?: ButtonVariant }) {
  const off = disabled || loading;
  const filled = variant !== 'secondary';
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      ph-label={phLabel}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        disabled && styles.disabled,
        pressed && !off && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={filled ? palette.onAccent : palette.textDim} />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, filled ? styles.filledLabel : styles.secondaryLabel, disabled && styles.disabledLabel]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} variant="primary" />;
}

export function SecondaryButton(props: ButtonProps) {
  return <Button {...props} variant="secondary" />;
}

export function DangerButton(props: ButtonProps) {
  return <Button {...props} variant="danger" />;
}

/**
 * 글자만 있는 낮은 버튼(「건너뛰기」 같은 보조 링크) — 14/700 회색. 큰 버튼 아래 둘째·셋째 선택지에 쓴다.
 * tone="accent"는 파란 글자 링크 — pen S3.2·S5.2 「다시 불러오기」(안쪽 [8,16]).
 * size="large"는 버튼 자리를 대신하는 글자 — pen 가입 7/7 「건너뛰기」(높이 56 · 17/700 #8B95A1).
 */
export function TextButton({
  label,
  onPress,
  disabled,
  accessibilityLabel,
  phLabel,
  tone = 'muted',
  size = 'small',
}: ButtonProps & { tone?: 'muted' | 'accent'; size?: 'small' | 'large' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      ph-label={phLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.text,
        tone === 'accent' && styles.textAccent,
        size === 'large' && styles.textLarge,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.textLabel, tone === 'accent' && styles.textLabelAccent, size === 'large' && styles.textLabelLarge]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: palette.blue },
  secondary: { backgroundColor: palette.bgSoft },
  danger: { backgroundColor: palette.danger },
  disabled: { backgroundColor: palette.border },
  pressed: { opacity: 0.85 },
  label: { fontSize: 17, fontWeight: '700' },
  filledLabel: { color: palette.onAccent },
  secondaryLabel: { color: palette.textDim },
  disabledLabel: { color: palette.checkOff },
  text: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  textLabel: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  textAccent: { paddingHorizontal: 16 },
  textLabelAccent: { color: palette.blue },
  textLarge: { height: 56, justifyContent: 'center', paddingVertical: 0 },
  textLabelLarge: { fontSize: 17 },
});
