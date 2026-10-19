import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

const MASCOT = require('@/assets/images/mascot-reading.png');

/**
 * pen 「리딩 실행 · 처음 ①~⑤」(SOMA-748) — 왼쪽 마스코트, 오른쪽 흰 말풍선(주황 소제목 12/800 + 설명 15/800, 그림자).
 * 화면을 막지 않는다 — 누르면 닫힌다.
 */
export function ReadingCoachMark({ label, text, onClose }: { label: string; text: string; onClose: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onClose} accessibilityRole="button" accessibilityLabel={text} ph-label="reading_coach_mark">
      <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  mascot: { width: 72, height: 80 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: palette.card,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  label: { fontSize: 12, fontWeight: '800', color: palette.flameDeep },
  text: { fontSize: 15, fontWeight: '800', lineHeight: 22, color: palette.text },
});
