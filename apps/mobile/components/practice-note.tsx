import { StyleSheet, Text, View } from 'react-native';
import type { PublicPracticeNote } from '@/lib/api';
import { practiceNoteSections } from '@/lib/report-display';
import { palette } from '@/constants/palette';

export function PracticeNoteBody({ note }: { note: PublicPracticeNote }) {
  return <View style={styles.body}>{practiceNoteSections(note).map((section, index) => (
    <View style={styles.section} key={`${index}-${section.label}`}>
      <Text style={styles.label}>{section.label}</Text>
      <Text style={styles.text}>{section.text}</Text>
    </View>
  ))}</View>;
}

const styles = StyleSheet.create({
  body: { gap: 22 },
  section: { borderTopWidth: 1, borderTopColor: palette.borderSoft, paddingTop: 16, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: palette.textDim },
  text: { fontSize: 16, lineHeight: 26, color: palette.text },
});
