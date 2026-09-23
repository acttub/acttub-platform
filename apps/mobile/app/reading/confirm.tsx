import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import {
  addDraftCharacter,
  draftCharacters,
  draftParsed,
  draftSummary,
  draftTitle,
  removeDraftCharacter,
  renameDraftCharacter,
  setDraftTitle,
  validateDraft,
  type ScriptDraft,
} from '@/lib/reading/script-draft';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { getPendingDraft, saveDraft, setPendingDraft } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 확인 화면(reading.script). 저장 전에 배역 이름을 고치고, 잘못 잡힌 배역을 빼고(그 줄은 지문이
 * 된다), 빠진 이름을 더해 다시 나눈다. 저장은 한 요청이고, 화면을 떠나면 아무것도 저장되지 않는다 —
 * 원문은 초안이 잠시 들고 있다가 버린다.
 */
const PREVIEW_LINES = 6;

export default function ReadingConfirm() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alert, dialog } = useAppDialog();
  const [draft, setDraft] = useState<ScriptDraft | null>(() => getPendingDraft());
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const [addName, setAddName] = useState('');

  // 화면을 떠나면 초안을 버린다. 저장한 뒤에는 이미 비어 있다.
  useEffect(() => () => setPendingDraft(null), []);

  const characters = useMemo(() => (draft ? draftCharacters(draft) : []), [draft]);
  const summary = useMemo(() => (draft ? draftSummary(draft) : null), [draft]);
  const preview = useMemo(() => (draft ? draftParsed(draft).lines.slice(0, PREVIEW_LINES) : []), [draft]);

  if (!draft || !summary) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading/new')}>
          <Text style={styles.pillText}>대본 넣기로</Text>
        </Pressable>
      </View>
    );
  }

  const commitRename = () => {
    if (!renaming) return;
    setDraft(renameDraftCharacter(draft, renaming.key, renaming.name));
    setRenaming(null);
  };
  const remove = (key: string) => {
    setRenaming(null);
    setDraft(removeDraftCharacter(draft, key));
  };
  const add = () => {
    const name = addName.trim();
    if (!name) return;
    const result = addDraftCharacter(draft, name);
    if (!result.added) {
      void alert({ title: t('reading.addCharacter'), message: t('reading.addCharacterMissing', { name }) });
      return;
    }
    setDraft(result.draft);
    setAddName('');
  };

  const onSave = async () => {
    const checked = validateDraft(draft);
    if (!checked.ok) {
      void alert({ title: t('common.save'), message: scriptErrorMessage(checked.code) });
      return;
    }
    setBusy(true);
    try {
      await saveDraft(draft);
      router.replace('/reading/roles');
    } catch (e) {
      void alert({ title: t('common.save'), message: scriptErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const canSave = characters.length > 0 && !busy;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>STEP 2 · 대본 확인</Text>
        <Text style={styles.title}>{t('reading.confirmHeading')}</Text>
        <Text style={styles.sub}>{t('reading.confirmSub')}</Text>

        <Text style={styles.label}>{t('reading.titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={draft.title ?? draftTitle(draft)}
          onChangeText={(v) => setDraft(setDraftTitle(draft, v))}
          placeholder={t('reading.untitled')}
          placeholderTextColor={palette.textFaint}
        />

        <View style={styles.summaryCard}>
          <Feather name="file-text" size={16} color={palette.blue} />
          <Text style={styles.summaryText}>
            {t('reading.confirmSummary', { characters: summary.characters, dialogues: summary.dialogues, directions: summary.directions })}
          </Text>
        </View>

        <Text style={styles.label}>{t('reading.charactersLabel')}</Text>
        {characters.length === 0 && (
          <View style={styles.warn}>
            <Feather name="alert-circle" size={14} color={palette.amber} />
            <Text style={styles.warnText}>{t('reading.confirmNoCharacters')}</Text>
          </View>
        )}
        <View style={styles.list}>
          {characters.map((c) => {
            const editing = renaming?.key === c.key;
            return (
              <View key={c.key} style={styles.row}>
                <View style={styles.rowBody}>
                  {editing ? (
                    <TextInput
                      style={styles.rowInput}
                      value={renaming.name}
                      autoFocus
                      onChangeText={(name) => setRenaming({ key: c.key, name })}
                      onSubmitEditing={commitRename}
                      onBlur={commitRename}
                      returnKeyType="done"
                    />
                  ) : (
                    <Text style={styles.rowName}>{c.name}</Text>
                  )}
                  <Text style={styles.rowMeta}>{t('reading.dialogueCount', { count: c.dialogueCount })}</Text>
                </View>
                <Pressable
                  style={styles.iconBtn}
                  hitSlop={6}
                  accessibilityLabel={t('reading.renameCharacter')}
                  onPress={() => (editing ? commitRename() : setRenaming({ key: c.key, name: c.name }))}>
                  <Feather name={editing ? 'check' : 'edit-2'} size={16} color={palette.blueDeep} />
                </Pressable>
                <Pressable style={styles.iconBtn} hitSlop={6} accessibilityLabel={t('reading.removeCharacter')} onPress={() => remove(c.key)}>
                  <Feather name="x" size={16} color={palette.textDim} />
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={styles.hint}>{t('reading.removeCharacterHint')}</Text>

        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            value={addName}
            onChangeText={setAddName}
            placeholder={t('reading.addCharacterPlaceholder')}
            placeholderTextColor={palette.textFaint}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable style={[styles.addBtn, !addName.trim() && styles.addBtnOff]} onPress={add} disabled={!addName.trim()}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={styles.addText}>{t('reading.addCharacter')}</Text>
          </Pressable>
        </View>

        {preview.length > 0 && (
          <View style={styles.preview}>
            {preview.map((l, i) =>
              l.type === 'dialogue' ? (
                <Text key={i} style={styles.previewLine} numberOfLines={1}>
                  <Text style={styles.previewRole}>{renamedName(draft, l.role)}</Text>  {l.text}
                </Text>
              ) : (
                <Text key={i} style={[styles.previewLine, l.type === 'scene' ? styles.previewScene : styles.previewDirection]} numberOfLines={1}>
                  {l.text}
                </Text>
              ),
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.primary, !canSave && styles.primaryOff]} onPress={onSave} disabled={!canSave}>
          <Text style={styles.primaryText}>{busy ? t('common.saving') : t('common.save')}</Text>
        </Pressable>
      </View>
      {dialog}
    </View>
  );
}

function renamedName(draft: ScriptDraft, key: string): string {
  return (draft.renames[key] ?? key).trim() || key;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20, marginBottom: 4 },
  label: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 13, marginTop: 6 },
  input: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: palette.text, fontFamily: 'Pretendard', fontSize: 15 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 12, padding: 12 },
  summaryText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.amberSoft, borderRadius: 10, padding: 12 },
  warnText: { color: palette.amber, fontFamily: 'Pretendard', fontSize: 13, flex: 1, lineHeight: 19 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  rowInput: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15, padding: 0, borderBottomColor: palette.blue, borderBottomWidth: 1 },
  rowMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  hint: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: { flex: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  addBtnOff: { backgroundColor: palette.checkOff },
  addText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  preview: { backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 12, gap: 4, marginTop: 6 },
  previewLine: { color: palette.text, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  previewRole: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold' },
  previewDirection: { color: palette.textMuted, fontStyle: 'italic' },
  previewScene: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold' },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
