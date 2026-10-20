import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 코치 화면 맨 위 「오늘 영상」 줄 — 누르면 영상을 펼친다(pen 질문 대화 첫 응답). 분석 대기(「영상 보는 중」)와 대화가
 * 같은 줄을 쓴다(SOMA-778). 64 썸네일(모서리 14, 가운데 재생 동그라미 36) · 글 14/800 · 보조 12/600.
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
          <Feather name={open ? 'chevron-up' : 'play'} size={18} color={palette.onAccent} />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowOn: { opacity: 0.6 },
  thumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: palette.textDim, alignItems: 'center', justifyContent: 'center' },
  thumbPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 6 },
  title: { fontSize: 14, fontWeight: '800', lineHeight: 21, color: palette.text },
  sub: { fontSize: 12, fontWeight: '600', lineHeight: 18, color: palette.textFaint },
});
