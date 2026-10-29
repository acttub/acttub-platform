import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import type { CoachPurpose } from '@/lib/practice/types';

type CardKey = 'good' | 'issue' | 'next';

// 평가 결과 · 막힌 곳 정리 — 항목마다 점 색(green 잘된 곳 · danger 아쉬운/막힌 곳 · blue 다음/해 볼 것).
const DOT: Record<CardKey, string> = { good: palette.green, issue: palette.danger, next: palette.blue };
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
        </View>
      )) : card ? ORDER[kind].map((key) => {
        const item = card[key];
        if (!item?.text) return null;
        return <View key={key} style={styles.row}>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: DOT[key] }]} />
            <Text style={styles.label} testID="coach-purpose-label">{t(LABEL[kind][key])}</Text>
            {hasVideo && item.at != null ? <Pressable style={styles.time} accessibilityRole="button" hitSlop={8} onPress={() => onSeek(item.at!)}>
              <Text style={styles.timeText}>{`▷ ${clock(item.at)}`}</Text>
            </Pressable> : null}
          </View>
          <Text style={styles.value}>{item.text}</Text>
        </View>;
      }) : null}
    </View>
  );
}

// 테두리 카드 — 흰 바탕 · 1px border · r-lg · 안쪽 16. 제목 body2-bold, 항목 머리 micro 회색, 글 body2. 인물 카드의 출처(배우·코치)는
// 보이지 않는다 — 역할 코드가 화면에 그대로 나오던 자리다.
const styles = StyleSheet.create({
  card: { padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg, gap: space[3] },
  title: { ...type.body2Bold, color: palette.text },
  row: { gap: space[1] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  label: { ...type.micro, color: palette.textMeta },
  value: { ...type.body2, color: palette.text },
  time: { borderRadius: radius.full, paddingVertical: 2, paddingHorizontal: space[2], backgroundColor: palette.blueSoft },
  timeText: { ...type.micro, color: palette.blueDeep },
});
