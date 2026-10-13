import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { LineEditSheet } from '@/components/line-edit-sheet';
import { palette } from '@/constants/palette';
import type { LineDraft } from '@/lib/reading/line-edit';
import { getCurrent, isMyRole, type SavedScript } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 전체(R3.4). 목소리 정하기의 [전체 보기]와 대본 상세의 「대본 보기」가 같이 연다. 줄을 누르면 나누기가 틀린 줄을
 * 고치는 시트가 뜬다(SOMA-669) — 종류·배역·글만 고치고 줄 id 는 그대로다.
 */
export default function ReadingFull() {
  const router = useRouter();
  const [script, setScript] = useState<SavedScript | null>(getCurrent);
  const [editing, setEditing] = useState<{ index: number; draft: LineDraft } | null>(null);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  const openEditor = (index: number) => {
    const line = script.lines[index];
    const characterId = line.type === 'dialogue' ? script.characters.find((c) => c.name === line.role)?.id ?? null : null;
    setEditing({ index, draft: { kind: line.type, characterId, text: line.text } });
  };

  return (
    <>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{script.title}</Text>
        <Text style={styles.hint}>{t('reading.lineEditHint')}</Text>
        {script.lines.map((l, i) => (
          <Pressable
            key={script.lineIds[i] ?? i}
            onPress={() => openEditor(i)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityHint={t('reading.lineEditTitle')}>
            {l.type === 'scene' ? (
              <Text style={styles.scene}>{l.text}</Text>
            ) : l.type === 'direction' ? (
              <Text style={styles.direction}>{l.text}</Text>
            ) : (
              <View style={styles.line}>
                <Text style={[styles.role, isMyRole(l.role) && styles.roleMine]}>{l.role}</Text>
                <Text style={styles.text}>{l.text}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <LineEditSheet
        scriptId={script.id}
        lineId={editing ? script.lineIds[editing.index] ?? null : null}
        original={editing?.draft ?? null}
        characters={script.characters}
        onClose={(saved) => {
          setEditing(null);
          if (saved) setScript(getCurrent());
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 4, paddingBottom: 60 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 20 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, marginTop: 2, marginBottom: 8 },
  row: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8 },
  rowPressed: { backgroundColor: palette.bgSoft },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, fontStyle: 'italic', lineHeight: 21 },
  scene: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 6 },
  line: { gap: 2 },
  role: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  roleMine: { color: palette.blueDeep },
  text: { color: palette.text, fontFamily: 'Pretendard', fontSize: 16, lineHeight: 24 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
