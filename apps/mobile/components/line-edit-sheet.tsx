import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { translate as t } from '@/lib/i18n';
import { canSaveLineDraft, lineDraftValid, linePatch, type LineDraft } from '@/lib/reading/line-edit';
import { editScriptLine, updateScriptMeta } from '@/lib/reading/store';
import type { LineKind, ScriptCharacter } from '@/lib/reading/types';

const KINDS: LineKind[] = ['dialogue', 'direction', 'scene'];

/**
 * 대본 줄 고치기 시트(SOMA-669, reading.script). 대본 전체(R3.4)에서 줄을 누르면 뜬다. 나누기가 틀린 줄의 종류(대사·지문·장면),
 * 말하는 배역, 글을 고친다. 줄 id 는 그대로라 지난 리딩·녹음·외운 줄은 그대로 남는다. 고르는 배역의 이름도 여기서 고친다
 * (「민재(소리)」처럼 잘못 잡힌 이름).
 */
export function LineEditSheet({
  scriptId,
  lineId,
  original,
  characters,
  onClose,
}: {
  scriptId: string;
  lineId: string | null;
  original: LineDraft | null;
  characters: ScriptCharacter[];
  onClose: (saved: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [draft, setDraft] = useState<LineDraft | null>(original);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDraft(original);
    setRenaming(null);
    setFailed(false);
  }, [original]);

  if (!lineId || !original || !draft) return null;
  const selected = characters.find((c) => c.id === draft.characterId) ?? null;
  // 배역 이름은 고르는 배역에서 같이 고친다. 이름만 고쳐도 저장된다.
  const renameChanged = renaming !== null && !!selected && renaming.trim() !== '' && renaming.trim() !== selected.name;
  const canSave = !busy && (canSaveLineDraft(original, draft) || (renameChanged && lineDraftValid(draft)));

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (renameChanged && selected) await updateScriptMeta(scriptId, { characters: [{ id: selected.id, name: renaming!.trim() }] });
      const change = linePatch(original, draft);
      if (change) await editScriptLine(scriptId, lineId, change);
      onClose(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={() => !busy && onClose(false)}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose(false)} accessibilityRole="button" />
      <View
        style={[styles.sheet, { bottom: keyboard, paddingBottom: (keyboard > 0 ? 12 : Math.max(insets.bottom, 16)) + 12 }]}
        accessibilityViewIsModal>
        <Text style={styles.title}>{t('reading.lineEditTitle')}</Text>
        <Text style={styles.sub}>{t('reading.lineEditSub')}</Text>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          <View style={styles.kinds}>
            {KINDS.map((kind) => (
              <Pressable
                key={kind}
                style={[styles.kind, draft.kind === kind && styles.kindOn]}
                onPress={() => setDraft({ ...draft, kind, characterId: kind === 'dialogue' ? draft.characterId ?? original.characterId : draft.characterId })}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.kind === kind }}>
                <Text style={[styles.kindText, draft.kind === kind && styles.kindTextOn]}>{t(`reading.lineKind.${kind}`)}</Text>
              </Pressable>
            ))}
          </View>

          {draft.kind === 'dialogue' && (
            <>
              <Text style={styles.label}>{t('reading.lineEditWho')}</Text>
              <View style={styles.roles}>
                {characters.map((c) => (
                  <Pressable
                    key={c.id}
                    style={[styles.role, draft.characterId === c.id && styles.roleOn]}
                    onPress={() => {
                      setDraft({ ...draft, characterId: c.id });
                      setRenaming(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: draft.characterId === c.id }}>
                    <Text style={[styles.roleText, draft.characterId === c.id && styles.roleTextOn]}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
              {selected &&
                (renaming === null ? (
                  <Pressable hitSlop={8} onPress={() => setRenaming(selected.name)} style={styles.renameLink}>
                    <Text style={styles.renameLinkText}>{t('reading.lineEditRename', { name: selected.name })}</Text>
                  </Pressable>
                ) : (
                  <TextInput
                    style={styles.input}
                    value={renaming}
                    onChangeText={setRenaming}
                    autoFocus
                    maxLength={40}
                    placeholder={selected.name}
                    placeholderTextColor={palette.textFaint}
                    accessibilityLabel={t('reading.lineEditRename', { name: selected.name })}
                  />
                ))}
            </>
          )}

          <Text style={styles.label}>{t('reading.lineEditText')}</Text>
          <TextInput
            style={[styles.input, styles.textInput]}
            value={draft.text}
            onChangeText={(text) => setDraft({ ...draft, text })}
            multiline
            maxLength={5000}
            textAlignVertical="top"
            accessibilityLabel={t('reading.lineEditText')}
          />
          {failed && <Text style={styles.error}>{t('reading.lineEditFailed')}</Text>}
        </ScrollView>

        <View style={styles.buttons}>
          <Pressable style={[styles.button, styles.cancel]} onPress={() => onClose(false)} disabled={busy}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.save, !canSave && styles.saveOff]} onPress={() => void save()} disabled={!canSave}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2, 9, 19, 0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    maxHeight: '85%',
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  title: { fontSize: 21, fontWeight: '800', color: palette.text },
  sub: { fontSize: 14, color: palette.textMuted, marginTop: 8 },
  body: { marginTop: 18 },
  bodyContent: { gap: 10, paddingBottom: 4 },
  kinds: { flexDirection: 'row', backgroundColor: palette.bgSoft, borderRadius: 12, padding: 4 },
  kind: { flex: 1, alignItems: 'center', borderRadius: 9, paddingVertical: 10 },
  kindOn: { backgroundColor: palette.card, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  kindText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  kindTextOn: { color: palette.text, fontFamily: 'Pretendard-Bold' },
  label: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 13, marginTop: 6 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.card },
  roleOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  roleText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  roleTextOn: { color: palette.blueDeep },
  renameLink: { alignSelf: 'flex-start' },
  renameLinkText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textDecorationLine: 'underline' },
  input: {
    backgroundColor: palette.bgSubtle,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.text,
    fontFamily: 'Pretendard',
    fontSize: 15,
  },
  textInput: { minHeight: 96, maxHeight: 180, lineHeight: 22 },
  error: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  cancel: { backgroundColor: palette.bgSoft },
  cancelText: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  save: { backgroundColor: palette.blue },
  saveOff: { backgroundColor: palette.checkOff },
  saveText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
});
