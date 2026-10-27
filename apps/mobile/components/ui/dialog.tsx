import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 확인창 — 디자인 시스템 pen 「Dialog」. 폭 320, r-xl, 안쪽 24, 가운데 정렬, 제목 headline(결과 문장), 설명 body2 `text-sub`.
 * 버튼은 DialogButtons — 위 16 띄운 [취소 | 확인] 두 칸(Button 48). 위험한 확인은 danger.
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
        <Button variant="secondary" label={cancelLabel} onPress={() => onCancel?.()} disabled={busy} style={styles.fill} />
      ) : null}
      <Button variant={destructive ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} loading={busy} style={styles.fill} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 320, backgroundColor: palette.bg, borderRadius: radius.xl, padding: space[6], gap: space[2] },
  title: { ...type.headline, color: palette.text, textAlign: 'center' },
  message: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', gap: space[2], paddingTop: space[4] },
  fill: { flex: 1 },
});
