import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';

import { ReadingNoScript } from '@/components/reading/no-script';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { useAppDialog } from '@/components/app-dialog';
import { LineEditSheet } from '@/components/line-edit-sheet';
import { LineInsertCard } from '@/components/line-insert-card';
import { LineSplitSheet } from '@/components/line-split-sheet';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { classifyUnprocessable } from '@/lib/api-request';
import type { LineDraft } from '@/lib/reading/line-edit';
import { deleteScriptLine, getCurrent, isMyRole, type SavedScript } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';
import { isMonologue } from '@/lib/reading/monologue';
import { lineGroups } from '@/lib/reading/line-groups';
import type { GestureResponderEvent } from 'react-native';

import { pt } from '@/components/ui/anchored-menu';

/** 지우기 거절 사유 → 문구. 그 밖의 실패는 저장 실패 문구다. */
const DELETE_REFUSED: Record<string, string> = {
  empty_range: 'reading.lineDeleteEmptyRange',
  invalid_line: 'reading.lineDeleteLast',
};

/**
 * 대본 전체(R3.4). 목소리 정하기의 [전체 보기]와 대본 상세의 「대본 보기」가 같이 연다. 줄을 누르면 메뉴가 뜬다(SOMA-785) —
 * 고치기(SOMA-669, 종류·배역·글만 고치고 줄 id 는 그대로), 나누기(앞 조각이 그 줄 id 에 남는다), 아래에 추가(SOMA-816, 그 줄
 * 바로 아래 빈 칸에 새 대사), 지우기(한 번 묻는다).
 */
export default function ReadingFull() {
  const [script, setScript] = useState<SavedScript | null>(getCurrent);
  const [editing, setEditing] = useState<{ index: number; draft: LineDraft } | null>(null);
  const [splitting, setSplitting] = useState<number | null>(null);
  /** 아래에 대사를 추가하려고 고른 줄(SOMA-816). 그 줄 바로 아래에 빈 칸이 열린다. */
  const [inserting, setInserting] = useState<number | null>(null);
  const { sheet, confirm, alert, dialog } = useAppDialog();

  if (!script) return <ReadingNoScript />;

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
      void alert({ title: t(key ? 'reading.lineDeleteRefusedTitle' : 'reading.lineDeleteFailTitle'), message: t(key ?? 'reading.lineEditFailed') });
    }
  };

  const openMenu = (index: number, e?: GestureResponderEvent) => {
    const line = script.lines[index];
    sheet({
      anchor: pt(e),
      title: line.type === 'dialogue' ? `${line.role} · ${line.text}` : line.text,
      actions: [
        { label: t('reading.lineMenuEdit'), onPress: () => openEditor(index) },
        { label: t('reading.lineMenuSplit'), onPress: () => setSplitting(index) },
        { label: t('reading.lineMenuInsert'), onPress: () => setInserting(index) },
        { label: t('reading.lineMenuDelete'), destructive: true, onPress: () => void removeLine(index) },
      ],
    });
  };

  /** 고른 줄이 대사면 그 배역의 id(처음 고르는 말하는 쪽을 정한다). */
  const insertAnchorCharacterId = (index: number) => {
    const line = script.lines[index];
    return line.type === 'dialogue' ? script.characters.find((c) => c.name === line.role)?.id ?? null : null;
  };

  const monologue = isMonologue(script.characters);
  /** 줄 하나 — 묶인 대사(SOMA-806) 안에서도 줄마다 눌러 메뉴를 연다. */
  const row = (i: number, body: React.ReactNode, joined?: 'head' | 'rest') => (
    <View key={script.lineIds[i] ?? i}>
      <Pressable
        onPress={(e) => openMenu(i, e)}
        style={({ pressed }) => [styles.row, joined === 'head' && styles.rowHead, joined === 'rest' && styles.rowJoined, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityHint={t('reading.lineEditTitle')}>
        {body}
      </Pressable>
      {inserting === i && script.lineIds[i] && (
        <LineInsertCard
          scriptId={script.id}
          lineId={script.lineIds[i]}
          lineCharacterId={insertAnchorCharacterId(i)}
          characters={script.characters}
          onClose={(saved) => {
            setInserting(null);
            if (saved) setScript(getCurrent());
          }}
        />
      )}
    </View>
  );

  return (
    <>
      {/* 줄 아래에 대사를 더할 때(LineInsertCard) 입력칸이 키보드에 가리지 않게 따라 올라간다. */}
      <KeyboardAwareScroll style={styles.root} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Text style={styles.title}>{script.title}</Text>
          {/* 독백은 서버가 문장마다 나눠 둔다(SOMA-597) — 그 안내가 줄 고치기 안내 자리에 온다(pen UQWzz). */}
          <Text style={styles.hint}>{t(monologue ? 'reading.monologueFullNote' : 'reading.lineEditHint')}</Text>
        </View>
        {/* 같은 배역 연속 대사는 배역 이름 하나 아래 줄마다 이어 보인다(SOMA-806). 저장된 줄은 그대로다. */}
        {lineGroups(script.lines, { monologue }).map(({ start, end }) => {
          const l = script.lines[start];
          if (l.type !== 'dialogue') return row(start, <Text style={l.type === 'scene' ? styles.scene : styles.direction}>{l.text}</Text>);
          const rows = script.lines.slice(start, end + 1).map((g, k) =>
            k === 0
              ? row(start, (
                  <View style={styles.line}>
                    <Text style={[styles.role, isMyRole(l.role) && styles.roleMine]} numberOfLines={1}>{l.role}</Text>
                    <Text style={styles.text}>{g.text}</Text>
                  </View>
                ), start < end ? 'head' : undefined)
              : row(start + k, <Text style={[styles.text, styles.textJoined]}>{g.text}</Text>, 'rest'),
          );
          return start === end ? rows : <View key={script.lineIds[start] ?? start}>{rows}</View>;
        })}
      </KeyboardAwareScroll>
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
  content: { paddingHorizontal: space.gutter, paddingTop: space[2], gap: space[1], paddingBottom: space[10] },
  head: { gap: space[1], marginBottom: space[3] },
  title: { ...type.title2, color: palette.text },
  hint: { ...type.caption, color: palette.textMeta },
  row: { borderRadius: 8, paddingHorizontal: space[2], paddingVertical: space[2], marginHorizontal: -space[2] },
  /** 묶인 대사의 줄 — 한 대사로 보이게 위아래를 좁힌다. */
  rowHead: { paddingBottom: 1 },
  rowJoined: { paddingVertical: 1 },
  rowPressed: { backgroundColor: palette.bgSoft },
  direction: { ...type.caption, color: palette.textMeta, borderLeftColor: palette.border, borderLeftWidth: 2, paddingLeft: space[3] },
  scene: { ...type.body2Bold, color: palette.textSub, marginTop: space[1.5] },
  role: { ...type.captionBold, width: 44, color: palette.text, paddingTop: 1 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  roleMine: { color: palette.blueDeep },
  text: { ...type.body2, flex: 1, color: palette.text },
  textJoined: { marginLeft: 56 },
});
