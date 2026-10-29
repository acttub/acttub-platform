import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { InlineErrorLine } from '@/components/ui/inline-error';
import { useReadableInput } from '@/hooks/use-readable-input';
import type { InputCharsetMode } from '@/lib/practice/readable-text';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

const noop = () => {};

/**
 * 디자인 시스템 pen 「TextField/Default·Focus·Error」 — 이름표(body2-bold text-sub) 아래 흰 바탕 입력칸.
 * 높이 48 · r-md · 1px border, 입력 중 1.5px blue, `error`가 있으면 1.5px danger 와 아래 InlineError/Line 한 줄.
 */
export const TextField = forwardRef<TextInput, TextInputProps & { label?: string; error?: string | null; charset?: InputCharsetMode | 'off' }>(function TextField(
  { label, error, style, onFocus, onBlur, charset, onChangeText, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // 허용 글자 범위(SOMA-922): 기본은 strict. 비밀번호 칸은 건드리지 않고, 대본 글은 charset="loose" 로 받는다.
  const mode = charset ?? (input.secureTextEntry ? 'off' : 'strict');
  const readable = useReadableInput(onChangeText ?? noop, mode === 'off' ? 'strict' : mode);
  const change = mode === 'off' ? onChangeText : readable.onChangeText;
  const note = error ?? (mode === 'off' ? null : readable.hint);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={palette.textMeta}
        accessibilityLabel={label}
        {...input}
        onChangeText={change}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, focused && styles.focus, !!error && styles.error, style]}
      />
      {note ? <InlineErrorLine message={note} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  label: { ...type.body2Bold, color: palette.textSub },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: space[4],
    ...type.body1,
    lineHeight: undefined,
    color: palette.text,
  },
  focus: { borderWidth: 1.5, borderColor: palette.blue, paddingHorizontal: space[4] - 0.5 },
  error: { borderWidth: 1.5, borderColor: palette.danger, paddingHorizontal: space[4] - 0.5 },
});
