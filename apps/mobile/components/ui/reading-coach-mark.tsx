import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';

/**
 * pen 「리딩 실행 · 처음 ①~⑤」(SOMA-748·770) — 왼쪽 액티(86×96), 오른쪽 흰 말풍선(모서리 18, 1px #E5E8EB 테두리,
 * 주황 소제목 12/800 + 설명 15/800 줄높이 1.45, 그림자).
 * 화면을 막지 않는다 — 누르면 닫힌다.
 */
export function ReadingCoachMark({ label, text, onClose }: { label: string; text: string; onClose: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onClose} accessibilityRole="button" accessibilityLabel={text} ph-label="reading_coach_mark">
      <Image source={MASCOT.reading} style={MASCOT_SIZE.guide} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: palette.bg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  label: { fontSize: 12, fontWeight: '800', lineHeight: 17, color: palette.text },
  text: { fontSize: 15, fontWeight: '800', lineHeight: 22, color: palette.text },
});
