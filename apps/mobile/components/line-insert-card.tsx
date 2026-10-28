import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, TextButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { useReadableInput } from '@/hooks/use-readable-input';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
  const readable = useReadableInput(setText, 'loose');
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

  const chip = (value: string, label: string) => (
    <Chip key={value} size="sm" role="radio" label={label} selected={speaker === value} disabled={busy} onPress={() => setSpeaker(value)} />
  );
  const off = busy || !canInsertLine(draft);

  return (
    <View style={styles.card}>
      <View style={styles.chips} accessibilityLabel={t('reading.lineEditWho')}>
        {characters.map((c) => chip(c.id, c.name))}
        {chip('direction', t('reading.lineKind.direction'))}
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={readable.onChangeText}
        multiline
        autoFocus
        maxLength={5000}
        textAlignVertical="top"
        placeholder={t('reading.lineInsertPlaceholder')}
        placeholderTextColor={palette.textMeta}
        accessibilityLabel={t('reading.lineInsertPlaceholder')}
      />
      {readable.hint ? <InlineErrorLine message={readable.hint} /> : null}
      {failed && <InlineErrorLine message={t('reading.lineEditFailed')} />}
      <View style={styles.buttons}>
        <TextButton label={t('common.cancel')} onPress={() => onClose(false)} disabled={busy} />
        <Button size="sm" label={t('reading.lineInsertSave')} onPress={() => void save()} disabled={off} loading={busy} loadingLabel={t('loadingText.saving')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.bg, borderColor: palette.blue, borderWidth: 1.5, borderRadius: radius.lg, padding: space[3], gap: space[3], marginVertical: space[1.5] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  input: { ...type.body2, color: palette.text, minHeight: 44, maxHeight: 140, padding: 0 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space[2] },
});
