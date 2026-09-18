import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

export type RecordMode = 'ai' | 'challenge';

/**
 * 촬영 전에 용도를 고르는 시트 — 하단 탭 촬영 버튼이 연다.
 * 찍고 나서 고르던 흐름(record-choice)을 뒤집었다: 먼저 고르고, 찍으면 바로 그 흐름으로 간다.
 */
export function RecordModeSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (mode: RecordMode) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{t('recordMode.title')}</Text>
        <Pressable
          style={({ pressed }) => [styles.option, styles.optionPrimary, pressed && styles.pressed]}
          onPress={() => onPick('ai')}
          accessibilityRole="button">
          <View style={[styles.icon, styles.iconPrimary]}>
            <Ionicons name="chatbubbles-outline" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.body}>
            <Text style={[styles.optionTitle, styles.optionTitlePrimary]}>{t('recordMode.ai')}</Text>
            <Text style={[styles.optionSub, styles.optionSubPrimary]}>{t('recordMode.aiSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.9)" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          onPress={() => onPick('challenge')}
          accessibilityRole="button">
          <View style={styles.icon}>
            <Ionicons name="trophy-outline" size={22} color="#E9A23B" />
          </View>
          <View style={styles.body}>
            <Text style={styles.optionTitle}>{t('recordMode.challenge')}</Text>
            <Text style={styles.optionSub}>{t('recordMode.challengeSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={palette.checkOff} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,20,30,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text, marginBottom: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    padding: 16,
  },
  optionPrimary: { backgroundColor: palette.blue, borderColor: palette.blue },
  pressed: { opacity: 0.85 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF4DE', alignItems: 'center', justifyContent: 'center' },
  iconPrimary: { backgroundColor: 'rgba(255,255,255,0.22)' },
  body: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  optionTitlePrimary: { color: '#FFFFFF' },
  optionSub: { fontSize: 12.5, color: palette.textFaint, marginTop: 3 },
  optionSubPrimary: { color: 'rgba(255,255,255,0.85)' },
});
