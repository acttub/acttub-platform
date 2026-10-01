import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { noteSections, quoteSourceLabel } from '@/lib/practice/note';
import type { PracticeNote } from '@/lib/practice/types';

/**
 * 연습 노트의 본문 칸들(요약 → 다음 한 가지 → 응원). 방금 끝낸 노트(A13)와 지난 노트(A12)가 같은 모양으로 그린다.
 * 칸 사이 간격은 부모의 gap 을 따르도록 감싸지 않고 칸을 그대로 늘어놓는다.
 */
export function NoteSections({ note }: { note: PracticeNote }) {
  return (
    <>
      {noteSections(note).map((section) => (
        <View style={styles.section} key={section.kind}>
          {!!section.label && <Text style={styles.label}>{section.label}</Text>}
          {section.kind === 'summary' ? (
            section.quotes.length > 0 ? (
              section.quotes.map((quote, index) => (
                <View style={styles.quote} key={`${index}-${quote.quote.slice(0, 8)}`}>
                  <Text style={styles.quoteText}>{quote.quote}</Text>
                  <Text style={styles.quoteSource}>{quoteSourceLabel(quote.kind)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.text}>{section.text}</Text>
            )
          ) : (
            <Text style={[styles.text, section.kind === 'next' && styles.next, section.kind === 'cheer' && styles.cheer]}>
              {section.text}
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 16, lineHeight: 26, color: palette.text },
  next: { fontSize: 18, fontWeight: '700', lineHeight: 29 },
  cheer: { fontSize: 14, lineHeight: 23, color: palette.textDim },
  quote: { gap: 4, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 14 },
  quoteText: { fontSize: 15.5, lineHeight: 25, color: palette.text },
  quoteSource: { fontSize: 11.5, fontWeight: '800', color: palette.textFaint },
});
