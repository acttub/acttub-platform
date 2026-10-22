import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { translate as t } from '@/lib/i18n';
import { splitGuess } from '@/lib/reading/line-edit';
import { splitScriptLine } from '@/lib/reading/store';

/**
 * 대본 줄 둘로 나누기 시트(SOMA-785, reading.script). 대본 전체(R3.4) 줄 메뉴의 「둘로 나누기」가 연다. 자를 곳을 짐작해 앞뒤 칸을
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
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
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
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={parts[index]}
        onChangeText={(value) => setParts(index === 0 ? [value, parts[1]] : [parts[0], value])}
        multiline
        maxLength={5000}
        textAlignVertical="top"
        accessibilityLabel={label}
      />
    </>
  );

  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={() => !busy && onClose(false)}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose(false)} accessibilityRole="button" />
      <View
        style={[styles.sheet, { bottom: keyboard, paddingBottom: (keyboard > 0 ? 12 : Math.max(insets.bottom, 16)) + 12 }]}
        accessibilityViewIsModal>
        <Text style={styles.title}>{t('reading.lineMenuSplit')}</Text>
        <Text style={styles.sub}>{t('reading.lineSplitSub')}</Text>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          {field(0, t('reading.lineSplitFirst'))}
          {field(1, t('reading.lineSplitSecond'))}
          {failed && <Text style={styles.error}>{t('reading.lineEditFailed')}</Text>}
        </ScrollView>
        <View style={styles.buttons}>
          <SecondaryButton label={t('common.cancel')} onPress={() => onClose(false)} disabled={busy} style={styles.button} />
          <PrimaryButton label={t('reading.lineSplitSave')} onPress={() => void save()} disabled={!canSave} loading={busy} style={styles.button} />
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
  label: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 13, marginTop: 6 },
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
    minHeight: 72,
    maxHeight: 160,
    lineHeight: 22,
  },
  error: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1 },
});
