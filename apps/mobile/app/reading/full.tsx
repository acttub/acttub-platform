import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { useAppDialog } from '@/components/app-dialog';
import { LineEditSheet } from '@/components/line-edit-sheet';
import { LineSplitSheet } from '@/components/line-split-sheet';
import { palette } from '@/constants/palette';
import { classifyUnprocessable } from '@/lib/api-request';
import type { LineDraft } from '@/lib/reading/line-edit';
import { deleteScriptLine, getCurrent, isMyRole, type SavedScript } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';
import { isMonologue } from '@/lib/reading/monologue';
import { lineGroups } from '@/lib/reading/line-groups';

/** 지우기 거절 사유 → 문구. 그 밖의 실패는 저장 실패 문구다. */
const DELETE_REFUSED: Record<string, string> = {
  empty_range: 'reading.lineDeleteEmptyRange',
  invalid_line: 'reading.lineDeleteLast',
};

/**
 * 대본 전체(R3.4). 목소리 정하기의 [전체 보기]와 대본 상세의 「대본 보기」가 같이 연다. 줄을 누르면 메뉴가 뜬다(SOMA-785) —
 * 고치기(SOMA-669, 종류·배역·글만 고치고 줄 id 는 그대로), 둘로 나누기(앞 조각이 그 줄 id 에 남는다), 지우기(한 번 묻는다).
 */
export default function ReadingFull() {
  const router = useRouter();
  const [script, setScript] = useState<SavedScript | null>(getCurrent);
  const [editing, setEditing] = useState<{ index: number; draft: LineDraft } | null>(null);
  const [splitting, setSplitting] = useState<number | null>(null);
  const { sheet, confirm, alert, dialog } = useAppDialog();

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

  const removeLine = async (index: number) => {
    const ok = await confirm({ title: t('reading.lineDeleteTitle'), message: t('reading.lineDeleteBody'), confirmLabel: t('reading.lineDeleteConfirm'), destructive: true });
    if (!ok) return;
    try {
      await deleteScriptLine(script.id, script.lineIds[index]);
      setScript(getCurrent());
    } catch (e) {
      const kind = classifyUnprocessable(e);
      const key = kind?.kind === 'reason' ? DELETE_REFUSED[kind.code] : undefined;
      void alert({ title: t('reading.lineMenuDelete'), message: t(key ?? 'reading.lineEditFailed') });
    }
  };

  const openMenu = (index: number) => {
    const line = script.lines[index];
    sheet({
      title: line.type === 'dialogue' ? `${line.role} · ${line.text}` : line.text,
      actions: [
        { label: t('reading.lineMenuEdit'), onPress: () => openEditor(index) },
        { label: t('reading.lineMenuSplit'), onPress: () => setSplitting(index) },
        { label: t('reading.lineMenuDelete'), destructive: true, onPress: () => void removeLine(index) },
      ],
    });
  };

  const monologue = isMonologue(script.characters);
  /** 줄 하나 — 묶인 대사(SOMA-806) 안에서도 줄마다 눌러 메뉴를 연다. */
  const row = (i: number, body: React.ReactNode, joined?: 'head' | 'rest') => (
    <Pressable
      key={script.lineIds[i] ?? i}
      onPress={() => openMenu(i)}
      style={({ pressed }) => [styles.row, joined === 'head' && styles.rowHead, joined === 'rest' && styles.rowJoined, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityHint={t('reading.lineEditTitle')}>
      {body}
    </Pressable>
  );

  return (
    <>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{script.title}</Text>
        {/* 독백은 서버가 문장마다 나눠 둔다(SOMA-597) — 그 안내가 줄 고치기 안내 자리에 온다(pen UQWzz). */}
        <Text style={styles.hint}>{t(monologue ? 'reading.monologueFullNote' : 'reading.lineEditHint')}</Text>
        {/* 같은 배역 연속 대사는 배역 이름 하나 아래 줄마다 이어 보인다(SOMA-806). 저장된 줄은 그대로다. */}
        {lineGroups(script.lines, { monologue }).map(({ start, end }) => {
          const l = script.lines[start];
          if (l.type !== 'dialogue') return row(start, <Text style={l.type === 'scene' ? styles.scene : styles.direction}>{l.text}</Text>);
          const rows = script.lines.slice(start, end + 1).map((g, k) =>
            k === 0
              ? row(start, (
                  <View style={styles.line}>
                    <Text style={[styles.role, isMyRole(l.role) && styles.roleMine]}>{l.role}</Text>
                    <Text style={styles.text}>{g.text}</Text>
                  </View>
                ), start < end ? 'head' : undefined)
              : row(start + k, <Text style={styles.text}>{g.text}</Text>, 'rest'),
          );
          return start === end ? rows : <View key={script.lineIds[start] ?? start}>{rows}</View>;
        })}
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
      <LineSplitSheet
        scriptId={script.id}
        lineId={splitting === null ? null : script.lineIds[splitting] ?? null}
        text={splitting === null ? null : script.lines[splitting]?.text ?? null}
        onClose={(saved) => {
          setSplitting(null);
          if (saved) setScript(getCurrent());
        }}
      />
      {dialog}
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
  /** 묶인 대사의 줄 — 한 대사로 보이게 위아래를 좁힌다. */
  rowHead: { paddingBottom: 1 },
  rowJoined: { paddingVertical: 1 },
  rowPressed: { backgroundColor: palette.bgSoft },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, fontStyle: 'italic', lineHeight: 21 },
  scene: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15, marginTop: 6 },
  role: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  line: { gap: 2 },
  roleMine: { color: palette.blueDeep },
  text: { color: palette.text, fontFamily: 'Pretendard', fontSize: 16, lineHeight: 24 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
