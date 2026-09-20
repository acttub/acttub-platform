import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { getCurrent, updateScriptMeta } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/**
 * 제목·배역 수정 시트(R00.3, reading.script). 저장 뒤에는 줄 구조가 고정이라 제목과 배역 이름만
 * 고친다. 배역 id·줄 연결·목소리는 그대로다. 이름은 앞뒤 공백을 정리하고, 비어 있거나 같은 대본 안에서
 * 겹치면 invalid_characters 다 — 기기가 먼저 거르고 서버도 같은 코드로 거절한다.
 */
export default function ReadingEdit() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alert, dialog } = useAppDialog();
  const script = getCurrent();
  const [title, setTitle] = useState(script?.title ?? '');
  const [names, setNames] = useState(() => (script?.characters ?? []).map((c) => ({ id: c.id, name: c.name })));
  const [busy, setBusy] = useState(false);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.back()}>
          <Text style={styles.pillText}>{t('common.close')}</Text>
        </Pressable>
      </View>
    );
  }

  const trimmed = names.map((n) => ({ id: n.id, name: n.name.trim() }));
  const invalid = trimmed.some((n) => !n.name) || new Set(trimmed.map((n) => n.name)).size !== trimmed.length;
  const nextTitle = title.trim() || t('reading.untitled');
  const changed =
    nextTitle !== script.title || trimmed.some((n, i) => n.name !== (script.characters[i]?.name ?? ''));

  const onSave = async () => {
    if (invalid) {
      void alert({ title: t('reading.titleEdit'), message: scriptErrorMessage('invalid_characters') });
      return;
    }
    setBusy(true);
    try {
      await updateScriptMeta(script.id, { title: nextTitle, characters: trimmed });
      router.back();
    } catch (e) {
      void alert({ title: t('reading.titleEdit'), message: scriptErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t('reading.editHint')}</Text>

        <Text style={styles.label}>{t('reading.titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('reading.untitled')}
          placeholderTextColor={palette.textFaint}
        />

        <Text style={styles.label}>{t('reading.charactersLabel')}</Text>
        <View style={styles.list}>
          {names.map((n, i) => (
            <View key={n.id} style={styles.row}>
              <TextInput
                style={[styles.input, styles.rowInput, !n.name.trim() && styles.inputBad]}
                value={n.name}
                onChangeText={(v) => setNames((prev) => prev.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                placeholder={script.characters[i]?.name}
                placeholderTextColor={palette.textFaint}
              />
              <Text style={styles.rowMeta}>{t('reading.dialogueCount', { count: script.characters[i]?.dialogue_count ?? 0 })}</Text>
            </View>
          ))}
        </View>
        {invalid && <Text style={styles.bad}>{scriptErrorMessage('invalid_characters')}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.ghost]} onPress={() => router.back()} disabled={busy}>
          <Text style={styles.ghostText}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable style={[styles.primary, (invalid || !changed || busy) && styles.primaryOff]} onPress={onSave} disabled={invalid || !changed || busy}>
          <Text style={styles.primaryText}>{busy ? t('common.saving') : t('common.save')}</Text>
        </Pressable>
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  label: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 13, marginTop: 8 },
  input: { backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: palette.text, fontFamily: 'Pretendard', fontSize: 15 },
  inputBad: { borderColor: palette.danger },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowInput: { flex: 1 },
  rowMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, width: 64, textAlign: 'right' },
  bad: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 12 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  ghost: { flex: 1, backgroundColor: palette.bgSoft, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  ghostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  primary: { flex: 1.4, backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
