import { StyleSheet, Text, View } from 'react-native';

import { NoteCheer } from '@/components/note-cheer';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { noteSections, quoteSourceLabel } from '@/lib/practice/note';
import type { PracticeNote } from '@/lib/practice/types';

/**
 * 연습 노트의 본문 칸들(요약 → 다음 한 가지 → 응원). 방금 끝낸 노트(A13)와 지난 노트(A12)가 같은 모양으로 그린다.
 * 응원 칸은 고정 문장 대신 마스코트 말풍선(무작위 한마디)으로 그린다(SOMA-662).
 * 칸 사이 간격은 부모의 gap 을 따르도록 감싸지 않고 칸을 그대로 늘어놓는다.
 * 「이번에 해 본 것」 인용은 bg-subtle 카드(출처 micro), 「다음에 해 볼 것」은 blue-soft 카드에 굵게 둔다 — 코칭 끝 화면과 같은 카드다.
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
  section: { gap: space[2] },
  label: { ...type.captionBold, color: palette.textSub },
  text: { ...type.body2, color: palette.text },
  nextCard: { gap: space[1], backgroundColor: palette.blueSoft, borderRadius: radius.lg, padding: space[4] },
  nextLabel: { ...type.micro, color: palette.blueDeep },
  next: { ...type.body2Bold, color: palette.text },
  quote: { gap: space[1], backgroundColor: palette.bgSubtle, borderRadius: radius.lg, padding: space[4] },
  quoteText: { ...type.body1, color: palette.text },
  quoteSource: { ...type.micro, color: palette.textMeta },
});
