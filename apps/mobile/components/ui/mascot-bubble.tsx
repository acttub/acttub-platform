import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { palette } from '@/constants/palette';

/**
 * pen 「캐릭터 말풍선」(코칭·리딩 입구, SOMA-748) — 왼쪽 마스코트, 오른쪽 회색 말풍선(왼쪽 아래만 뾰족).
 * 말풍선 큰 글 20/800, 보조 14/600.
 */
export function MascotBubble({ source, title, body }: { source: ImageSourcePropType; title: string; body?: string }) {
  return (
    <View style={styles.row}>
      <Image source={source} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
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
  body: { fontSize: 14, fontWeight: '600', lineHeight: 21, color: palette.textMuted },
});
