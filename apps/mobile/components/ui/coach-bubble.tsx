import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

const MASCOT = require('@/assets/images/mascot-coach.png');

/**
 * 코칭 준비 화면들의 「캐릭터 말풍선」(pen 세션 목적·영상 고르기·장면 정보, SOMA-748).
 * 공통 MascotBubble 과 같은 모양이고, 아래 줄이 회색 보조가 아니라 파란 안내(누를 곳을 알려 주는 말)다.
 */
export function CoachBubble({ title, guide }: { title: string; guide?: string | null }) {
  return (
    <View style={styles.row}>
      <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.title}>{title}</Text>
        {guide ? <Text style={styles.guide}>{guide}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  mascot: { width: 70, height: 78 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: palette.bgSoft,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
  },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 28, color: palette.text },
  guide: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
});
