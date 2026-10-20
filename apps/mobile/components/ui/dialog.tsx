import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * 확인창·선택 시트 공통 부품(SOMA-770).
 *
 * - DialogCard — pen 「Dialog/Confirm」: 흰 카드 폭 334(최대), 모서리 22, 안쪽 [24,22,18,22], 제목 17/800 가운데,
 *   설명 14 #4E5968 줄높이 1.5 가운데(위 10), 버튼 줄(위 22).
 * - DialogButtons — 같은 카드의 [취소 | 확인] 두 칸: 모서리 14, 위아래 14, 간격 8. 취소 #F2F4F6 · 15/700, 확인 파랑(위험이면 빨강) · 15/800.
 * - ActionSheetCard — pen 「ActionSheet」: 흰 카드 모서리 20 · 위아래 4, 제목 13/700 회색, 항목 16/600(위 1px #E5E8EB 줄),
 *   8 띄우고 취소 칸(#F2F4F6 · 모서리 16 · 16/800).
 */
export function DialogCard({ title, message, children }: { title: string; message?: string | null; children?: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
    </View>
  );
}

export function DialogButtons({
  cancelLabel,
  onCancel,
  confirmLabel,
  onConfirm,
  destructive,
  busy,
}: {
  /** 없으면 확인 하나만(알림창). */
  cancelLabel?: string;
  onCancel?: () => void;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <View style={styles.buttonRow}>
      {cancelLabel ? (
        <Pressable
          style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button">
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.button, styles.confirm, destructive && styles.confirmDanger, pressed && styles.pressed]}
        onPress={onConfirm}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}>
        {busy ? <ActivityIndicator color={palette.onAccent} /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
      </Pressable>
    </View>
  );
}

export type SheetItem = { label: string; onPress: () => void; destructive?: boolean };

export function ActionSheetCard({
  title,
  items,
  cancelLabel,
  onCancel,
}: {
  title?: string;
  items: SheetItem[];
  cancelLabel: string;
  onCancel: () => void;
}) {
  return (
    <View style={styles.sheetWrap}>
      <View style={styles.sheet}>
        {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
        {items.map((item, index) => (
          <Pressable
            key={item.label}
            style={({ pressed }) => [styles.sheetItem, index > 0 && styles.sheetItemDivided, pressed && styles.pressed]}
            onPress={item.onPress}
            accessibilityRole="button">
            <Text style={[styles.sheetItemText, item.destructive && styles.destructiveText]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.sheetCancelText}>{cancelLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  card: {
    width: '100%',
    maxWidth: 334,
    backgroundColor: palette.card,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
  },
  title: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  message: { fontSize: 14, color: palette.textDim, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 22 },
  button: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  cancel: { backgroundColor: palette.bgSoft },
  cancelText: { fontSize: 15, fontWeight: '700', color: palette.textDim },
  confirm: { backgroundColor: palette.blue },
  confirmDanger: { backgroundColor: palette.danger },
  confirmText: { fontSize: 15, fontWeight: '800', color: palette.onAccent },

  sheetWrap: { width: '100%', gap: 8 },
  sheet: { width: '100%', backgroundColor: palette.card, borderRadius: 20, paddingVertical: 4 },
  sheetTitle: { fontSize: 13, fontWeight: '700', color: palette.textFaint, textAlign: 'center', paddingVertical: 12 },
  sheetItem: { paddingVertical: 17, alignItems: 'center' },
  sheetItemDivided: { borderTopWidth: 1, borderTopColor: palette.border },
  sheetItemText: { fontSize: 16, fontWeight: '600', color: palette.text },
  destructiveText: { color: palette.danger },
  sheetCancel: { paddingVertical: 17, alignItems: 'center', backgroundColor: palette.bgSoft, borderRadius: 16 },
  sheetCancelText: { fontSize: 16, fontWeight: '800', color: palette.textDim },
});
