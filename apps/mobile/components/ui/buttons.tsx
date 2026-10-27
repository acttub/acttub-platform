import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** loading 동안 글자 자리에 보여 줄 문구. 없으면 「잠시만요…」. */
  loadingLabel?: string;
  /** 글자 앞 아이콘. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** PostHog 누름 이름(ph-label). */
  phLabel?: string;
};

/** lg 48(headline) · md 40(body2-bold) · sm 32(body2-bold, 옅은 파랑 바탕). */
export type ButtonSize = 'lg' | 'md' | 'sm';

/**
 * 앱의 기본 버튼 — 디자인 시스템 pen 「Button/*」. 높이 48·40·32, 모서리 16(32 는 12).
 * primary: blue · on-accent / secondary: bg-soft · text-sub / danger: danger · on-accent. sm 은 blue-soft · blue-deep 하나다.
 * 막혀 있으면 어느 모양이든 Disabled(border 바탕 · text-disabled 글자), 처리 중이면 60% 흐림과 「~하는 중…」 문구.
 */
export function Button({
  label,
  onPress,
  disabled,
  loading,
  loadingLabel,
  icon,
  style,
  accessibilityLabel,
  phLabel,
  variant = 'primary',
  size = 'lg',
}: ButtonProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  const off = disabled || loading;
  const small = size === 'sm';
  const filled = variant !== 'secondary' && !small;
  const labelStyle = [
    size === 'lg' ? styles.label : styles.labelSmall,
    small ? styles.smLabel : filled ? styles.filledLabel : styles.secondaryLabel,
  ];
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
        size === 'md' && styles.md,
        small && styles.sm,
        disabled && styles.disabled,
        loading && styles.busy,
        pressed && !off && styles.pressed,
        style,
      ]}>
      {loading ? (
        // 로딩 표시 대신 문구를 보여 준다(SOMA-828).
        <Text style={labelStyle}>
          {loadingLabel ?? t('loadingText.wait')}
        </Text>
      ) : (
        <>
          {icon}
          <Text style={[labelStyle, disabled && styles.disabledLabel]}>
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
 * 글자 버튼 — pen 「Button/Text」·「Button/Text-link」. 높이 40, 안쪽 좌우 16, body2-bold.
 * 보조 선택지는 text-sub, tone="accent"(링크·강조)는 blue-deep.
 * size="large"는 버튼 자리를 대신하는 글자 — pen 가입 7/7 「건너뛰기」(높이 56 · headline).
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
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
  },
  md: { height: 40 },
  sm: { height: 32, borderRadius: radius.md, backgroundColor: palette.blueSoft },
  primary: { backgroundColor: palette.blue },
  secondary: { backgroundColor: palette.bgSoft },
  danger: { backgroundColor: palette.danger },
  disabled: { backgroundColor: palette.border },
  busy: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  label: type.headline,
  labelSmall: type.body2Bold,
  filledLabel: { color: palette.onAccent },
  secondaryLabel: { color: palette.textSub },
  smLabel: { color: palette.blueDeep },
  disabledLabel: { color: palette.textDisabled },
  text: { alignSelf: 'center', height: 40, justifyContent: 'center', paddingHorizontal: space[4] },
  textLabel: { ...type.body2Bold, color: palette.textSub },
  textLabelAccent: { color: palette.blueDeep },
  textLarge: { height: 56 },
  textLabelLarge: type.headline,
});
