import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';

export type VideoSourceOption = {
  key: string;
  icon: 'archive' | 'video' | 'image';
  title: string;
  sub: string;
  onPress: () => void;
};

const ICON_TONE: Record<VideoSourceOption['icon'], { bg: string; fg: string }> = {
  archive: { bg: palette.blueSoft, fg: palette.blue },
  video: { bg: '#FFF1DE', fg: palette.hintIcon },
  image: { bg: palette.bgSoft, fg: palette.textMuted },
};

/**
 * 새 연습 준비에서 영상 상자를 누르면 뜨는 아래 시트(SOMA-656). 보관함·촬영·갤러리 중 어디서 영상을 가져올지 고른다.
 * 줄을 누르면 시트를 닫고 그 갈래를 연다 — 여는 쪽(화면)이 시트가 닫힌 뒤에 다음 창을 띄운다.
 */
export function VideoSourceSheet({
  visible,
  title,
  sub,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  sub: string;
  options: VideoSourceOption[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]} accessibilityViewIsModal>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
        <View style={styles.rows}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={option.onPress}
              accessibilityRole="button"
              accessibilityLabel={option.title}>
              <View style={[styles.icon, { backgroundColor: ICON_TONE[option.icon].bg }]}>
                <Feather name={option.icon} size={20} color={ICON_TONE[option.icon].fg} />
              </View>
              <View style={styles.text}>
                <Text style={styles.rowTitle}>{option.title}</Text>
                <Text style={styles.rowSub}>{option.sub}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={palette.checkOff} />
            </Pressable>
          ))}
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
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  title: { fontSize: 21, fontWeight: '800', color: palette.text },
  sub: { fontSize: 14, color: palette.textMuted, marginTop: 8 },
  rows: { gap: 10, marginTop: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    backgroundColor: palette.card,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  rowSub: { fontSize: 13, color: palette.textMuted },
});
