import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 디자인 시스템 pen 「InlineError」 — 화면 일부(목록·댓글·설정 등)를 불러오지 못했을 때.
 * danger-soft 상자 · 경고 아이콘 20 · 문구 body2-bold · 오른쪽 흰 「다시 시도」 32.
 */
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Feather name="alert-circle" size={20} color={palette.danger} />
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        ph-label="inline_error_retry"
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
        <Text style={styles.retryLabel}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 디자인 시스템 pen 「InlineError/Line」 — 누른 일·입력(저장·보내기·제출)이 실패했을 때.
 * 상자 없이 경고 아이콘 16 · caption danger 한 줄을 입력칸·버튼 바로 위아래에 둔다.
 */
export function InlineErrorLine({ message }: { message: string }) {
  return (
    <View style={styles.line} accessibilityRole="alert">
      <Feather name="alert-circle" size={16} color={palette.danger} />
      <Text style={styles.lineText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: palette.dangerSoft,
  },
  message: { flex: 1, ...type.body2Bold, color: palette.text },
  retry: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  pressed: { opacity: 0.7 },
  retryLabel: { ...type.body2Bold, color: palette.textSub },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  lineText: { flex: 1, ...type.caption, color: palette.danger },
});
