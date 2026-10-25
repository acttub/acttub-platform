import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { updateScriptMeta } from '@/lib/reading/store';
import { LoadingText } from '@/components/ui/loading-text';
import { translate as t } from '@/lib/i18n';

/**
 * 「혼자 하는 대본이에요」(pen QDEP8, SOMA-597). 배역 이름 없는 독백을 나누면 서버가 임시 이름(「화자」)을 붙여 두므로, 대본 넣기 끝에
 * 누구의 대사인지 이름을 받는다. 저장하면 배역 이름만 고친다(줄은 그대로). 닫으면(안드로이드 뒤로 가기) 임시 이름 그대로 둔다.
 */
export function MonologueNameDialog({
  target,
  onClose,
}: {
  target: { scriptId: string; characterId: string } | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!target) return null;
  const next = name.trim();

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await updateScriptMeta(target.scriptId, { characters: [{ id: target.characterId, name: next }] });
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={() => !busy && onClose()}>
      {/* 키보드가 뜨면 키보드 위 남은 칸 가운데에 놓여 「저장」이 가리지 않는다. */}
      <KeyboardLift style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('reading.monologueNameTitle')}</Text>
          <Text style={styles.body}>{t('reading.monologueNameBody')}</Text>
          <View style={[styles.field, failed && styles.fieldBad]}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('reading.monologueNamePlaceholder')}
              placeholderTextColor={palette.textFaint}
              autoFocus
            />
          </View>
          {failed && <Text style={styles.error}>{t('reading.titleSaveFail')}</Text>}
          <Pressable
            style={[styles.save, (!next || busy) && styles.saveOff]}
            disabled={!next || busy}
            onPress={() => void save()}
            accessibilityRole="button">
            {busy ? <LoadingText label={t('loadingText.saving')} color="#fff" /> : <Text style={styles.saveText}>{t('reading.monologueNameSave')}</Text>}
          </Pressable>
        </View>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  // pen Dialog/Confirm 과 같은 틀 — 버튼은 하나(이름을 정해야 다음으로 간다).
  card: { width: '100%', maxWidth: 334, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18 },
  title: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  body: { marginTop: 8, color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  field: {
    marginTop: 18,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
    paddingHorizontal: 14,
    height: 50,
    justifyContent: 'center',
  },
  fieldBad: { borderColor: palette.danger },
  input: { color: palette.text, fontFamily: 'Pretendard', fontSize: 15, padding: 0 },
  error: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13, marginTop: 10 },
  save: { marginTop: 18, borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blue },
  saveOff: { opacity: 0.5 },
  saveText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
