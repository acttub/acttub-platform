import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * pen 「온보딩 / 요약 행」 — 흰 바탕 · 1px #E5E8EB 테두리 · 모서리 16 · 안쪽 15. 왼쪽 라벨 14/600 #6B7684, 오른쪽 값 16/700.
 * 가입 질문에서 답한 칸을 아래에 쌓을 때 쓴다. `onPress`가 있으면 눌러 고칠 수 있다(읽는 이름은 「라벨 값」).
 */
export function SummaryRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}`}>
      {body}
    </Pressable>
  );
}

/**
 * pen 「7/7 · 지난 답변 수정」의 수정 중인 요약 행 — 요약 행 자리에서 1.5 #4880EE 테두리로 바뀌고(안쪽 [14,15,15,15], 줄 사이 12)
 * 머리(라벨 14/600 · 오른쪽 보조 12/600 #4880EE) 아래에 고르는 칩을 둔다.
 */
export function SummaryEditCard({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.edit}>
      <View style={styles.editHead}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.editHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  label: { fontSize: 14, fontWeight: '600', color: palette.textMeta },
  value: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: palette.text },
  edit: {
    gap: 12,
    paddingTop: 14,
    paddingBottom: 15,
    paddingHorizontal: 15,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.bg,
  },
  editHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editHint: { fontSize: 12, fontWeight: '600', color: palette.blue },
});
