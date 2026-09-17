import { StyleSheet, Text, View } from 'react-native';
import type { PublicPracticeNote } from '@/lib/api';
import { practiceNoteSections } from '@/lib/report-display';
import { palette } from '@/constants/palette';

export function PracticeNoteBody({ note }: { note: PublicPracticeNote }) {
  return <View style={styles.body}>{practiceNoteSections(note).map((section) => (
    <View style={styles.section} key={section.kind}>
      {!!section.label && <Text style={styles.label}>{section.label}</Text>}
      <Text style={[styles.text, section.kind === 'next' && styles.next, section.kind === 'encouragement' && styles.encouragement]}>{section.text}</Text>
    </View>
  ))}</View>;
}

const styles = StyleSheet.create({
  body: { gap: 22 },
  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 16, lineHeight: 26, color: palette.text },
  next: { fontSize: 18, fontWeight: '700', lineHeight: 29 },
  encouragement: { fontSize: 14, lineHeight: 23, color: palette.textDim },
});
