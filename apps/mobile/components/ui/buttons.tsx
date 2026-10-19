import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 글자 앞 아이콘. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * pen 「Button/Primary·Secondary·Disabled」(SOMA-748) — 높이 56, 모서리 16, 글자 16/700.
 * 막혀 있으면 Disabled 모양(회색 바탕·흐린 글자)으로 바뀐다.
 */
function BaseButton({ label, onPress, disabled, loading, icon, style, accessibilityLabel, variant }: ButtonProps & { variant: 'primary' | 'secondary' }) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        pressed && !off && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.onAccent : palette.textDim} />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel, disabled && styles.disabledLabel]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <BaseButton {...props} variant="primary" />;
}

export function SecondaryButton(props: ButtonProps) {
  return <BaseButton {...props} variant="secondary" />;
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: palette.blue },
  secondary: { backgroundColor: palette.bgSoft },
  disabled: { backgroundColor: palette.border },
  pressed: { opacity: 0.85 },
  label: { fontSize: 16, fontWeight: '700' },
  primaryLabel: { color: palette.onAccent },
  secondaryLabel: { color: palette.textDim },
  disabledLabel: { color: palette.textFaint },
});
