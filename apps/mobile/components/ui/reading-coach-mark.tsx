import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * pen 「리딩 실행 · 처음 ①~⑤」(SOMA-748·770) — 왼쪽 액티(86×96), 오른쪽 흰 말풍선(r-lg, 1px border),
 * 소제목 captionBold blue-deep + 설명 body1Bold.
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
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[1] },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: space[1.5],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    backgroundColor: palette.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  label: { ...type.captionBold, color: palette.blueDeep },
  text: { ...type.body1Bold, color: palette.text },
});
