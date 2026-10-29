import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { pickNoteCheer } from '@/lib/note-cheer';

const MASCOT = require('@/assets/images/mascot-cheer.png');

/** 연습 노트 끝 — 엄지를 든 마스코트와 응원 말풍선(SOMA-662, 디자인 P6.2). 한마디는 노트를 열 때 하나를 고른다. */
export function NoteCheer() {
  const [key] = useState(() => pickNoteCheer());
  return (
    <View style={styles.row}>
      <Image source={MASCOT} style={styles.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.text}>{t(key)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  mascot: { width: 72, height: 72 },
  bubble: {
    flex: 1,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  text: { fontSize: 14.5, fontWeight: '600', color: palette.textSub, lineHeight: 22 },
});
