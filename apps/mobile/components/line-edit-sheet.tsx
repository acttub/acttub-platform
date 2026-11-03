import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { TextField } from '@/components/ui/text-field';
import { LinePage } from '@/components/line-page';
import { translate as t } from '@/lib/i18n';
import { canSaveLineDraft, lineDraftValid, linePatch, type LineDraft } from '@/lib/reading/line-edit';
import { editScriptLine, updateScriptMeta } from '@/lib/reading/store';
import type { LineKind, ScriptCharacter } from '@/lib/reading/types';

const KINDS: LineKind[] = ['dialogue', 'direction', 'scene'];

/**
 * 대본 줄 고치기 페이지(SOMA-669, reading.script; SOMA-821에서 아래 시트를 전체 화면 페이지로 바꿨다). 대본 전체(R3.4)에서 줄을 누르면 뜬다. 나누기가 틀린 줄의 종류(대사·지문·장면),
 * 말하는 배역, 글을 고친다. 줄 id 는 그대로라 지난 리딩·녹음·외운 줄은 그대로 남는다. 고르는 배역의 이름도 여기서 고친다
 * (「민재(소리)」처럼 잘못 잡힌 이름).
 * `choices` 가 둘 이상이면(묶인 대사) 맨 위 「고칠 줄」 칩으로 줄을 고른다. 고르면 그 줄의 원본으로 바꿔 다시 고친다 —
 * 고를 줄 원본은 부르는 쪽이 주는 `original` 이 첫 줄 것이라, 바꾼 줄의 종류·배역·글은 `loadLine` 으로 받는다.
 */
export function LineEditSheet({
  scriptId,
  lineId,
  original,
  characters,
  choices,
  loadLine,
  onClose,
}: {
  scriptId: string;
  lineId: string | null;
  original: LineDraft | null;
  characters: ScriptCharacter[];
  choices?: { lineId: string; text: string }[];
  /** 묶인 줄에서 다른 줄을 골랐을 때 그 줄의 원본 초안. 없으면 글만 바꿔 보여 준다. */
  loadLine?: (lineId: string) => LineDraft | null;
  onClose: (saved: boolean) => void;
}) {
  const [target, setTarget] = useState<string | null>(lineId);
  const [base, setBase] = useState<LineDraft | null>(original);
  const [draft, setDraft] = useState<LineDraft | null>(original);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTarget(lineId);
    setBase(original);
    setDraft(original);
    setRenaming(null);
    setFailed(false);
  }, [original, lineId]);

  const pickLine = (id: string) => {
    if (id === target || busy) return;
    const next = loadLine?.(id) ?? (choices?.find((c) => c.lineId === id) && base ? { ...base, text: choices.find((c) => c.lineId === id)!.text } : null);
    if (!next) return;
    setTarget(id);
    setBase(next);
    setDraft(next);
    setRenaming(null);
    setFailed(false);
  };

  if (!lineId || !original || !draft || !base || !target) return null;
  const selected = characters.find((c) => c.id === draft.characterId) ?? null;
  // 배역 이름은 고르는 배역에서 같이 고친다. 이름만 고쳐도 저장된다.
  const renameChanged = renaming !== null && !!selected && renaming.trim() !== '' && renaming.trim() !== selected.name;
  const canSave = !busy && (canSaveLineDraft(base, draft) || (renameChanged && lineDraftValid(draft)));

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (renameChanged && selected) await updateScriptMeta(scriptId, { characters: [{ id: selected.id, name: renaming!.trim() }] });
      const change = linePatch(base, draft);
      if (change) await editScriptLine(scriptId, target, change);
      onClose(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinePage
      title={t('reading.lineEditTitle')}
      onClose={() => onClose(false)}
      busy={busy}
      footer={
        <>
          <TextButton label={t('common.cancel')} onPress={() => onClose(false)} disabled={busy} />
          <PrimaryButton label={t('common.save')} onPress={() => void save()} disabled={!canSave} loading={busy} />
        </>
      }>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>{t('reading.lineEditSub')}</Text>
        {choices && choices.length >= 2 && (
          <>
            <Text style={styles.label}>{t('reading.lineEditPickLabel')}</Text>
            <View style={styles.roles}>
              {choices.map((c, index) => (
                <Pressable
                  key={c.lineId}
                  style={[styles.role, target === c.lineId && styles.roleOn]}
                  onPress={() => pickLine(c.lineId)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: target === c.lineId }}
                  ph-label="reading_line_pick">
                  <Text style={[styles.roleText, target === c.lineId && styles.roleTextOn]} numberOfLines={1}>
                    {`${index + 1}. ${c.text}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <View style={styles.kinds}>
          {KINDS.map((kind) => (
            <Chip
              key={kind}
              role="radio"
              label={t(`reading.lineKind.${kind}`)}
              selected={draft.kind === kind}
              onPress={() => setDraft({ ...draft, kind, characterId: kind === 'dialogue' ? draft.characterId ?? base.characterId : draft.characterId })}
            />
          ))}
        </View>

        {draft.kind === 'dialogue' && (
          <>
            <Text style={styles.label}>{t('reading.lineEditWho')}</Text>
            <View style={styles.roles}>
              {characters.map((c) => (
                <Chip
                  key={c.id}
                  role="radio"
                  label={c.name}
                  selected={draft.characterId === c.id}
                  onPress={() => {
                    setDraft({ ...draft, characterId: c.id });
                    setRenaming(null);
                  }}
                />
              ))}
            </View>
            {selected &&
              (renaming === null ? (
                <Pressable hitSlop={8} onPress={() => setRenaming(selected.name)} style={styles.renameLink}>
                  <Text style={styles.renameLinkText}>{t('reading.lineEditRename', { name: selected.name })}</Text>
                </Pressable>
              ) : (
                <TextField
                  charset="loose"
                  value={renaming}
                  onChangeText={setRenaming}
                  autoFocus
                  maxLength={40}
                  placeholder={selected.name}
                  accessibilityLabel={t('reading.lineEditRename', { name: selected.name })}
                />
              ))}
          </>
        )}

        <TextField
          charset="loose"
          label={t('reading.lineEditText')}
          style={styles.textInput}
          value={draft.text}
          onChangeText={(text) => setDraft((was) => (was ? { ...was, text } : was))}
          multiline
          maxLength={5000}
          textAlignVertical="top"
        />
        {failed && <InlineErrorLine message={t('reading.lineEditFailed')} />}
      </ScrollView>
    </LinePage>
  );
}

const styles = StyleSheet.create({
  sub: { ...type.body2, color: palette.textMeta },
  body: { flex: 1 },
  bodyContent: { gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  kinds: { flexDirection: 'row', gap: space[2] },
  label: { ...type.body2Bold, color: palette.textSub, marginTop: 6 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  role: { maxWidth: '100%', borderRadius: radius.full, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.bg },
  roleOn: { borderColor: palette.blue, borderWidth: 1.5, backgroundColor: palette.blueSoft },
  roleText: { ...type.body2Bold, color: palette.textSub },
  roleTextOn: { color: palette.blueDeep },
  renameLink: { alignSelf: 'flex-start' },
  renameLinkText: { ...type.caption, color: palette.textMeta, textDecorationLine: 'underline' },
  textInput: { minHeight: 96, maxHeight: 180, paddingTop: space[3], paddingBottom: space[3] },
});
