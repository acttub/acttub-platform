import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { PronunciationNote } from '@/lib/reading/pronunciation-notes';

export type LineFeedback = { lineId: string; no: number | null; text: string; notes: PronunciationNote[] };

const clean = (s: string) => s.replace(/[^가-힣A-Za-z0-9]/g, '');

/** 대사에서 짚은 어절을 굵게 칠해 보인다. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  const marked = new Set(words);
  const parts = text.split(/(\s+)/);
  return (
    <Text style={styles.line}>
      {parts.map((part, i) => (marked.has(clean(part)) ? <Text key={i} style={styles.mark}>{part}</Text> : part))}
    </Text>
  );
}

/**
 * 리딩이 끝난 화면의 "발음 피드백(실험)" — 다르게 들린 어구가 있는 내 대사만. 리딩은 칭찬·점수를 내지 않는다
 * (reading 원칙) — 짚을 곳이 없는 줄은 보이지 않고 몇 줄을 봤는지만 적는다. 받아쓴 줄이 없으면 그리지 않는다.
 */
export function VoiceFeedbackSummary({ items }: { items: LineFeedback[] }) {
  if (items.length === 0) return null;
  const noted = items.filter((item) => item.notes.length > 0);
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('voiceFeedback.doneTitle')}</Text>
      <Text style={styles.note}>{t('voiceFeedback.doneNote', { n: items.length, k: noted.length })}</Text>
      {noted.map((item) => (
        <View key={item.lineId} style={styles.row}>
          {item.no !== null && <Text style={styles.lineNo}>{t('voiceFeedback.lineNo', { n: item.no })}</Text>}
          <Highlighted text={item.text} words={item.notes.map((n) => n.word)} />
          {item.notes.map((n) => (
            <Text key={n.word} style={styles.heard}>
              {n.heard ? t('voiceFeedback.heardAs', { word: n.word, heard: n.heard }) : t('voiceFeedback.notHeard', { word: n.word })}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 10, marginTop: 12 },
  title: { fontSize: 15, fontWeight: '900', color: palette.text },
  note: { fontSize: 12, color: palette.textFaint, marginTop: -6 },
  row: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.borderSoft },
  lineNo: { fontSize: 12, fontWeight: '800', color: palette.textFaint },
  line: { fontSize: 14.5, lineHeight: 22, color: palette.textDim, fontWeight: '600' },
  mark: { color: palette.flameDeep, fontWeight: '900', backgroundColor: palette.flameSoft },
  heard: { fontSize: 13, lineHeight: 19, color: palette.flameDeep, fontWeight: '700' },
});
