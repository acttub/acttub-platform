import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 코치 화면 맨 위 「오늘 영상」 줄 — 누르면 영상을 펼친다(pen 질문 대화 첫 응답). 분석 대기(「영상 보는 중」)와 대화가
 * 같은 줄을 쓴다(SOMA-778). pen 09 「오늘 영상」 — 56 썸네일(#4E5968, 모서리 14, 가운데 재생 동그라미 32 #333D4B · 아이콘 16),
 * 9 띄워 글 17/700 · 4 띄워 보조 15/500.
 */
export function CoachVideoRow({ open, sub, onPress }: { open: boolean; sub: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t('coach.stripTitle')} ${open ? t('common.fold') : t('common.unfold')}`}
      accessibilityState={{ expanded: open }}>
      <View style={styles.thumb}>
        <View style={styles.thumbPlay}>
          <Feather name={open ? 'chevron-up' : 'play'} size={16} color={palette.onAccent} />
        </View>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('coach.videoLabel')}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowOn: { opacity: 0.6 },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: palette.textDim, alignItems: 'center', justifyContent: 'center' },
  thumbPlay: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.textStrong, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 21, color: palette.text },
  sub: { fontSize: 15, fontWeight: '500', lineHeight: 19, color: palette.textFaint },
});
