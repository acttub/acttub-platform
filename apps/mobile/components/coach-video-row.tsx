import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 코치 화면 맨 위 「오늘 영상」 줄 — 누르면 영상을 펼친다(pen 질문 대화 첫 응답). 분석 대기(「영상 보는 중」)와 대화가
 * 같은 줄을 쓴다(SOMA-778). 44 어두운 칸(r-md) 가운데 재생 아이콘, 오른쪽 「오늘 영상」 body1-bold · 보조 caption.
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
        <Feather name={open ? 'chevron-up' : 'play'} size={20} color={palette.onAccent} />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowOn: { opacity: 0.6 },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: palette.text, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { ...type.body1Bold, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta },
});
