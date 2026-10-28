import { StyleSheet, Text, View } from 'react-native';

import { NoteCheer } from '@/components/note-cheer';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate } from '@/lib/i18n';
import { noteSections, quoteSourceLabel } from '@/lib/practice/note';
import type { PracticeNote } from '@/lib/practice/types';

/**
 * 연습 노트의 본문 칸들(요약 →(Pro) 대사별로 본 것 → 다음 한 가지 → 응원). 방금 끝낸 노트(A13)와 지난 노트(A12)가 같은 모양으로 그린다.
 * 응원 칸은 고정 문장 대신 마스코트 말풍선(무작위 한마디)으로 그린다(SOMA-662).
 * 칸 사이 간격은 부모의 gap 을 따르도록 감싸지 않고 칸을 그대로 늘어놓는다.
 * 모양은 pen 「새 · 배우 일지 첫 연습」(SOMA-748) — 「다음에 해 볼 것」은 옅은 파랑 카드에 굵게 둔다.
 */
export function NoteSections({ note }: { note: PracticeNote }) {
  return (
    <>
      {noteSections(note).map((section) => (
        <View style={section.kind === 'next' ? styles.nextCard : styles.section} key={section.kind}>
          {!!section.label && <Text style={[styles.label, section.kind === 'next' && styles.nextLabel]}>{section.label}</Text>}
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
          ) : section.kind === 'lines' ? (
            section.items.map((item, index) => (
              <View style={styles.quote} key={`${index}-${item.line.slice(0, 8)}`}>
                <Text style={styles.quoteText}>{`“${item.line}”`}</Text>
                <Text style={styles.text}>{item.seen}</Text>
                <Text style={styles.next}>{`${translate('note.lineTry')} · ${item.try}`}</Text>
              </View>
            ))
          ) : section.kind === 'cheer' ? (
            <NoteCheer />
          ) : (
            <Text style={styles.next}>{section.text}</Text>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  label: { fontSize: 13, fontWeight: '800', lineHeight: 20, color: palette.textDim },
  text: { fontSize: 15, fontWeight: '600', lineHeight: 22, color: palette.text },
  nextCard: { gap: 6, backgroundColor: palette.blueMist, borderRadius: 18, padding: 14 },
  nextLabel: { color: palette.blueDeep },
  next: { fontSize: 16, fontWeight: '800', lineHeight: 24, color: palette.text },
  quote: { gap: 4, backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 14 },
  quoteText: { fontSize: 15.5, lineHeight: 25, color: palette.text },
  quoteSource: { fontSize: 11.5, fontWeight: '800', color: palette.textFaint },
});
