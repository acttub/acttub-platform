import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { canInsertLine, defaultInsertSpeaker, insertLineOf } from '@/lib/reading/line-edit';
import { insertScriptLineAfter } from '@/lib/reading/store';
import type { ScriptCharacter } from '@/lib/reading/types';

/**
 * 대본 전체 · 아래에 대사 추가(SOMA-816, reading.script, pen iFkW7). 고른 줄 바로 아래에 열리는 빈 칸이다. 누구 대사인지(대본의
 * 배역들 + 지문)를 고르고 적어서 「추가」한다. 기존 줄 id 는 그대로라 지난 리딩·녹음·외운 줄은 그대로 남는다.
 */
export function LineInsertCard({
  scriptId,
  lineId,
  lineCharacterId,
  characters,
  onClose,
}: {
  scriptId: string;
  lineId: string;
  /** 고른 줄의 배역(대사가 아니면 null) — 처음 고르는 말하는 쪽을 정한다. */
  lineCharacterId: string | null;
  characters: ScriptCharacter[];
  onClose: (saved: boolean) => void;
}) {
  const [speaker, setSpeaker] = useState<string>(() => defaultInsertSpeaker(characters.map((c) => c.id), lineCharacterId));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const draft = { speaker, text };

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const line = insertLineOf(draft);
      await insertScriptLineAfter(scriptId, lineId, line);
      onClose(true);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const chip = (value: string, label: string) => {
    const on = speaker === value;
    return (
      <Pressable
        key={value}
        style={[styles.chip, on && styles.chipOn]}
        onPress={() => setSpeaker(value)}
        disabled={busy}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}>
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.chips} accessibilityLabel={t('reading.lineEditWho')}>
        {characters.map((c) => chip(c.id, c.name))}
        {chip('direction', t('reading.lineKind.direction'))}
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        maxLength={5000}
        textAlignVertical="top"
        placeholder={t('reading.lineInsertPlaceholder')}
        placeholderTextColor={palette.textFaint}
        accessibilityLabel={t('reading.lineInsertPlaceholder')}
      />
      {failed && <Text style={styles.error}>{t('reading.lineEditFailed')}</Text>}
      <View style={styles.buttons}>
        <Pressable hitSlop={8} onPress={() => onClose(false)} disabled={busy} accessibilityRole="button">
          <Text style={styles.cancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => void save()}
          disabled={busy || !canInsertLine(draft)}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !canInsertLine(draft) }}>
          <Text style={[styles.add, (busy || !canInsertLine(draft)) && styles.addOff]}>{t('reading.lineInsertSave')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 12, gap: 10, marginVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, backgroundColor: palette.bgSoft, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: palette.blueSoft },
  chipText: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 13 },
  chipTextOn: { color: palette.blueDeep },
  input: { color: palette.text, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22, minHeight: 44, maxHeight: 140, padding: 0 },
  error: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  cancel: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  add: { color: palette.blueDeep, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  addOff: { opacity: 0.4 },
});
