import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/** pen 「⑪ 리딩 · 나가기 확인」(SOMA-817) — 나가기를 누르거나 뒤로 가면 아래에서 올라오는 확인 창. */
export function ReadingExitSheet({
  visible,
  body,
  onLeave,
  onKeep,
}: {
  visible: boolean;
  body: string;
  onLeave: () => void;
  onKeep: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onKeep}>
      <Pressable style={styles.backdrop} onPress={onKeep} accessibilityRole="button" accessibilityLabel={t('reading.exitKeep')} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('reading.exitSheetTitle')}</Text>
        <Text style={styles.body}>{body}</Text>
        <PrimaryButton label={t('reading.exitLeave')} onPress={onLeave} />
        <Pressable style={styles.keep} onPress={onKeep} accessibilityRole="button">
          <Text style={styles.keepText}>{t('reading.exitKeep')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.checkOff, marginBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text },
  body: { fontSize: 14, lineHeight: 21, color: palette.textMuted, marginBottom: 8 },
  keep: { height: 48, alignItems: 'center', justifyContent: 'center' },
  keepText: { fontSize: 15, fontWeight: '600', color: palette.textMuted },
});
