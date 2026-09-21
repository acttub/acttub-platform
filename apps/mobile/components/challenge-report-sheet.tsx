import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { REPORT_REASONS } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/** A15.4 영상 신고 시트 — 사유 4개 중 하나를 고른다. 서버가 없어 고른 사유만 돌려준다. */
export function ChallengeReportSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (reason: (typeof REPORT_REASONS)[number]) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{t('videoReport.title')}</Text>
        <Text style={styles.subtitle}>{t('videoReport.subtitle')}</Text>
        {REPORT_REASONS.map((reason) => (
          <Pressable
            key={reason}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => onPick(reason)}
            accessibilityRole="button">
            <Text style={styles.rowText}>{t(`videoReport.${reason}`)}</Text>
            <Feather name="chevron-right" size={16} color={palette.checkOff} />
          </Pressable>
        ))}
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 13, color: palette.textFaint, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  pressed: { opacity: 0.7 },
  rowText: { fontSize: 14.5, fontWeight: '600', color: palette.text },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 14, fontWeight: '700', color: palette.blue },
});
