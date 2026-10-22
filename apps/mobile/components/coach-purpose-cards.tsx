import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { CoachPurpose } from '@/lib/practice/types';

/** 서버가 준 최신 카드만 그린다. 영상 없는 회차에는 시간 이동을 제공하지 않는다. */
export function CoachPurposeCards({ purpose, hasVideo, onSeek }: {
  purpose?: CoachPurpose | null;
  hasVideo: boolean;
  onSeek: (seconds: number) => void;
}) {
  if (!purpose) return null;
  const character = purpose.purpose === 'character' ? purpose.character_card : null;
  const card = purpose.purpose === 'evaluate' || (purpose.purpose === 'stuck' && purpose.step === 'wrap') ? purpose.card : null;
  if (!character && !card) return null;
  return (
    <View style={styles.card} testID="coach-purpose-card">
      <Text style={styles.title}>{t(character ? 'coach.purposeCharacter' : purpose.purpose === 'stuck' ? 'coach.purposeStuck' : 'coach.purposeResult')}</Text>
      {character ? character.cells.map((cell) => (
        <View key={cell.key} style={styles.row}>
          <Text style={styles.label}>{cell.label}</Text>
          <Text style={styles.value}>{cell.value || t('coach.purposeEmpty')}</Text>
          {cell.value && cell.source ? <Text style={styles.source}>{cell.source}</Text> : null}
        </View>
      )) : card ? (['good', 'issue', 'next'] as const).map((key) => {
        const item = card[key];
        if (!item?.text) return null;
        return <View key={key} style={styles.row}>
          <Text style={styles.label}>{t(`coach.purpose${key === 'good' ? 'Good' : key === 'issue' ? 'Issue' : 'Next'}`)}</Text>
          <Text style={styles.value}>{item.text}</Text>
          {hasVideo && item.at != null ? <Pressable accessibilityRole="button" onPress={() => onSeek(item.at!)}>
            <Text style={styles.source}>{Math.floor(item.at / 60)}:{String(item.at % 60).padStart(2, '0')}</Text>
          </Pressable> : null}
        </View>;
      }) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 18, backgroundColor: palette.bgSoft, gap: 14 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  row: { gap: 5 },
  label: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  value: { fontSize: 15, lineHeight: 23, color: palette.text },
  source: { fontSize: 12, fontWeight: '600', color: palette.blueDeep, alignSelf: 'flex-start' },
});
