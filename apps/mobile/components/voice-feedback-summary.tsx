import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { FeedbackChip } from '@/lib/reading/voice-feedback';

/** 칩 → 사용자에게 보이는 말. */
const CHIP_TEXT: Record<FeedbackChip, () => string> = {
  unclear: () => t('voiceFeedback.chipUnclear'),
  quiet: () => t('voiceFeedback.chipQuiet'),
  end_drop: () => t('voiceFeedback.chipEndDrop'),
  fast: () => t('voiceFeedback.chipFast'),
  slow: () => t('voiceFeedback.chipSlow'),
  flat: () => t('voiceFeedback.chipFlat'),
  pauses: () => t('voiceFeedback.chipPauses'),
};

export type LineFeedback = { lineId: string; no: number | null; text: string; chips: FeedbackChip[] };

/** 리딩이 끝난 화면의 "발성 피드백(실험)" — 내 대사마다 칩. 아무것도 못 봤으면 그리지 않는다. */
export function VoiceFeedbackSummary({ items }: { items: LineFeedback[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('voiceFeedback.doneTitle')}</Text>
      <Text style={styles.note}>{t('voiceFeedback.doneNote')}</Text>
      {items.map((item) => (
        <View key={item.lineId} style={styles.row}>
          <Text style={styles.line} numberOfLines={2}>
            {item.no !== null ? `${t('voiceFeedback.lineNo', { n: item.no })} · ` : ''}{item.text}
          </Text>
          <View style={styles.chips}>
            {item.chips.length === 0 ? (
              <Text style={[styles.chip, styles.good]}>{t('voiceFeedback.good')}</Text>
            ) : (
              item.chips.map((chip) => <Text key={chip} style={styles.chip}>{CHIP_TEXT[chip]()}</Text>)
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 10, marginTop: 12 },
  title: { fontSize: 15, fontWeight: '900', color: palette.text },
  note: { fontSize: 12, color: palette.textFaint, marginTop: -6 },
  row: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.borderSoft },
  line: { fontSize: 13.5, lineHeight: 20, color: palette.textDim, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 12.5, fontWeight: '800', color: palette.flameDeep, backgroundColor: palette.flameSoft, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  good: { color: palette.blueDeep, backgroundColor: palette.bg },
});
