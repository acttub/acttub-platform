import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { CoachPurpose } from '@/lib/practice/types';

type CardKey = 'good' | 'issue' | 'next';

// pen ⓐ1 평가 결과 · ⓑ5 막힌 곳 정리 — 항목마다 점 색(초록 잘된 곳 · 주황 아쉬운/막힌 곳 · 파랑 다음/해 볼 것).
// palette 에 아직 없는 초록·주황 점 값은 여기 둔다.
const DOT: Record<CardKey, string> = { good: '#2FA05A', issue: '#E2711D', next: palette.blue };
const ORDER: Record<'evaluate' | 'stuck', readonly CardKey[]> = {
  evaluate: ['good', 'issue', 'next'],
  stuck: ['issue', 'next', 'good'],
};
const LABEL: Record<'evaluate' | 'stuck', Record<CardKey, string>> = {
  evaluate: { good: 'coach.purposeGood', issue: 'coach.purposeIssue', next: 'coach.purposeNext' },
  stuck: { good: 'coach.purposeStuckGood', issue: 'coach.purposeStuckIssue', next: 'coach.purposeStuckNext' },
};

const clock = (at: number) => `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;

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
  const kind = purpose.purpose === 'stuck' ? 'stuck' : 'evaluate';
  return (
    <View style={styles.card} testID="coach-purpose-card">
      <Text style={styles.title}>{t(character ? 'coach.purposeCharacter' : purpose.purpose === 'stuck' ? 'coach.purposeStuck' : 'coach.purposeResult')}</Text>
      {character ? character.cells.map((cell) => (
        <View key={cell.key} style={styles.row}>
          <Text style={styles.label}>{cell.label}</Text>
          <Text style={styles.value}>{cell.value || t('coach.purposeEmpty')}</Text>
          {cell.value && cell.source ? <Text style={styles.source}>{cell.source}</Text> : null}
        </View>
      )) : card ? ORDER[kind].map((key) => {
        const item = card[key];
        if (!item?.text) return null;
        return <View key={key} style={styles.row}>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: DOT[key] }]} />
            <Text style={styles.label} testID="coach-purpose-label">{t(LABEL[kind][key])}</Text>
            {hasVideo && item.at != null ? <Pressable style={styles.time} accessibilityRole="button" hitSlop={8} onPress={() => onSeek(item.at!)}>
              <Text style={styles.timeText}>{`▶ ${clock(item.at)}`}</Text>
            </Pressable> : null}
          </View>
          <Text style={styles.value}>{item.text}</Text>
        </View>;
      }) : null}
    </View>
  );
}

// pen ⓐ1 「평가 결과」 카드 — 흰 바탕 · 테두리 · 모서리 16 · 안쪽 14 · 사이 10. 제목 14/800, 항목 머리 12/700 회색, 글 14/400(줄 21).
const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, gap: 10 },
  title: { fontSize: 14, fontWeight: '800', lineHeight: 20, color: palette.text },
  row: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 12, fontWeight: '700', lineHeight: 17, color: palette.textMeta },
  value: { fontSize: 14, lineHeight: 21, color: palette.text },
  source: { fontSize: 12, fontWeight: '600', color: palette.blueDeep, alignSelf: 'flex-start' },
  time: { borderRadius: 8, paddingVertical: 1, paddingHorizontal: 6, backgroundColor: palette.blueSoft },
  timeText: { fontSize: 11, fontWeight: '700', lineHeight: 15, color: palette.blueDeep },
});
