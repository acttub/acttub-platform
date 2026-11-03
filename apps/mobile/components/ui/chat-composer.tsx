import Feather from '@expo/vector-icons/Feather';
import type { Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「Chat/Composer」 — bg-soft, r-xl, 테두리 없음, 최소 높이 44, body1. 보내기는 칸 안 오른쪽 아래 36 동그라미(누르는 영역 44).
 * 보내기에는 꺼짐 상태가 없다. 보낼 수 없으면 버튼을 그리지 않는다. 한 줄로 시작해 다섯 줄쯤부터 칸 안에서 스크롤한다(SOMA-656).
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  canSend,
  sendLabel,
  placeholder,
  label,
  maxLength,
  editable,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  canSend: boolean;
  sendLabel: string;
  placeholder: string;
  label: string;
  maxLength: number;
  editable?: boolean;
  inputRef?: Ref<TextInput>;
}) {
  return (
    <View style={[styles.box, canSend && styles.boxWithSend]}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={palette.textMeta}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline
        editable={editable}
      />
      {canSend && (
        <Pressable style={styles.send} onPress={onSend} hitSlop={4} accessibilityRole="button" accessibilityLabel={sendLabel}>
          <Feather name="arrow-up" size={18} color={palette.onAccent} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    borderRadius: radius.xl,
    backgroundColor: palette.bgSoft,
    paddingVertical: space[1],
    paddingLeft: space[4],
    paddingRight: space[4],
  },
  boxWithSend: { paddingRight: space[1] },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 136,
    // 줄 간격을 따로 주면 안드로이드가 남는 간격을 글자 위에 몰아 글자가 처진다 — 기본 줄 간격에 위아래 8을 둔다.
    // pen 의 글 자리 위아래 6 · 줄 높이 24 와 글자 위치가 같다.
    paddingVertical: space[2],
    fontSize: type.body1.fontSize,
    color: palette.text,
    textAlignVertical: 'center',
  },
  send: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
});
