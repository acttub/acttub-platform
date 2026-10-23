import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 묶인 대사(같은 배역 연속 대사, SOMA-806)에서 고칠 줄 하나를 고르는 아래 시트 — pen R9.31b(10/24).
 * 모양은 줄 고치기 시트(R9.31, [[line-edit-sheet]])와 같은 틀: 흰 시트 위 모서리 24 · 제목 21/800 · 부제 · 줄 목록 · 「취소」.
 */
export function LinePickSheet({
  lines,
  onPick,
  onClose,
}: {
  /** 고를 줄 글. null 이면 닫혀 있다. */
  lines: string[] | null;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!lines) return null;
  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]} accessibilityViewIsModal>
        <Text style={styles.title}>{t('reading.lineEditPick')}</Text>
        <Text style={styles.sub}>{t('reading.lineEditPickSub')}</Text>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {lines.map((text, index) => (
            <Pressable
              key={index}
              style={({ pressed }) => [styles.option, pressed && styles.optionOn]}
              onPress={() => onPick(index)}
              accessibilityRole="button"
              ph-label="reading_line_pick">
              <Text style={styles.optionText}>{text}</Text>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.buttons}>
          <SecondaryButton label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2, 9, 19, 0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  title: { fontSize: 21, fontWeight: '800', color: palette.text },
  sub: { fontSize: 14, lineHeight: 20, color: palette.textMuted, marginTop: 8 },
  body: { marginTop: 18 },
  bodyContent: { gap: 10, paddingBottom: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
  },
  optionOn: { backgroundColor: palette.blueSoft },
  optionText: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 21, color: palette.text },
  buttons: { paddingTop: 16 },
});
