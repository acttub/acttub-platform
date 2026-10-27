import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { TextField } from '@/components/ui/text-field';
import { LinePage } from '@/components/line-page';
import { translate as t } from '@/lib/i18n';
import { splitGuess } from '@/lib/reading/line-edit';
import { splitScriptLine } from '@/lib/reading/store';

/**
 * 대본 줄 둘로 나누기 페이지(SOMA-785, reading.script; SOMA-821에서 아래 시트를 전체 화면 페이지로 바꿨다). 대본 전체(R3.4) 줄 메뉴의 「둘로 나누기」가 연다. 자를 곳을 짐작해 앞뒤 칸을
 * 채워 두고 사용자가 두 칸을 고쳐 정한다. 앞 칸은 그 줄(id 그대로)에 남아 지난 리딩·녹음이 이어지고 뒤 칸은 바로 뒤 새 줄이 된다.
 */
export function LineSplitSheet({
  scriptId,
  lineId,
  text,
  onClose,
}: {
  scriptId: string;
  lineId: string | null;
  text: string | null;
  onClose: (saved: boolean) => void;
}) {
  const [parts, setParts] = useState<[string, string]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (text !== null) setParts(splitGuess(text));
    setFailed(false);
  }, [text]);

  if (!lineId || text === null) return null;
  const canSave = !busy && !!parts[0].trim() && !!parts[1].trim();

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await splitScriptLine(scriptId, lineId, parts[0], parts[1]);
      onClose(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const field = (index: 0 | 1, label: string) => (
    <TextField
      label={label}
      style={styles.input}
      value={parts[index]}
      onChangeText={(value) => setParts(index === 0 ? [value, parts[1]] : [parts[0], value])}
      multiline
      maxLength={5000}
      textAlignVertical="top"
    />
  );

  return (
    <LinePage
      title={t('reading.lineMenuSplit')}
      onClose={() => onClose(false)}
      busy={busy}
      footer={
        <>
          <SecondaryButton label={t('common.cancel')} onPress={() => onClose(false)} disabled={busy} style={styles.button} />
          <PrimaryButton label={t('reading.lineSplitSave')} onPress={() => void save()} disabled={!canSave} loading={busy} loadingLabel={t('loadingText.saving')} style={styles.button} />
        </>
      }>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>{t('reading.lineSplitSub')}</Text>
        {field(0, t('reading.lineSplitFirst'))}
        {field(1, t('reading.lineSplitSecond'))}
        {failed && <InlineErrorLine message={t('reading.lineEditFailed')} />}
      </ScrollView>
    </LinePage>
  );
}

const styles = StyleSheet.create({
  sub: { ...type.body2, color: palette.textSub },
  body: { flex: 1 },
  bodyContent: { gap: space[4], paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[4] },
  input: { minHeight: 72, maxHeight: 160, paddingTop: space[3], paddingBottom: space[3] },
  button: { flex: 1 },
});
