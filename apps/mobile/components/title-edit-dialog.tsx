import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
import { palette } from '@/constants/palette';
import { updateScriptMeta } from '@/lib/reading/store';
import { translate as t } from '@/lib/i18n';

/**
 * 대본 제목 수정 팝업(R1.12, reading.script). 대본 탭 카드와 대본 상세 머리의 더보기에서 같이 연다.
 * 저장한 대본은 제목만 고친다(줄·배역 이름은 그대로). 제목이 바뀌어야 저장이 켜진다.
 */
export function TitleEditDialog({
  script,
  onClose,
}: {
  script: { id: string; title: string } | null;
  onClose: (saved: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTitle(script?.title ?? '');
    setFailed(false);
  }, [script]);

  if (!script) return null;
  const next = title.trim() || t('reading.untitled');
  const changed = next !== script.title;

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await updateScriptMeta(script.id, { title: next });
      onClose(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={() => onClose(false)}>
      {/* 키보드가 뜨면 키보드 위 남은 칸에서 다시 가운데·아래에 놓여 입력칸과 버튼이 가리지 않는다. */}
      <KeyboardLift>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose(false)} testID="title-edit-backdrop">
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t('reading.titleEdit')}</Text>
          <View style={[styles.field, failed && styles.fieldBad]}>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={t('reading.untitled')}
              placeholderTextColor={palette.textFaint}
              autoFocus
            />
            {!!title && (
              <Pressable hitSlop={8} onPress={() => setTitle('')} accessibilityRole="button" accessibilityLabel={t('common.close')} ph-label="title_edit_clear">
                <Feather name="x-circle" size={18} color={palette.textFaint} />
              </Pressable>
            )}
          </View>
          {failed && <Text style={styles.error}>{t('reading.titleSaveFail')}</Text>}
          <View style={styles.buttons}>
            <Pressable style={[styles.button, styles.cancel]} disabled={busy} onPress={() => onClose(false)}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.save, (!changed || busy) && styles.saveOff]}
              disabled={!changed || busy}
              onPress={() => void save()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  // pen Dialog/Confirm — 폭 334, 모서리 22, 안쪽 [24,22,18,22]. 저장은 바뀐 게 없으면 막혀야 해서 공통 DialogButtons 대신 같은 수치로 둔다.
  card: { width: '100%', maxWidth: 334, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18 },
  title: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: 14,
    backgroundColor: palette.bgSoft,
    paddingHorizontal: 14,
    height: 50,
  },
  fieldBad: { borderColor: palette.danger },
  input: { flex: 1, color: palette.text, fontFamily: 'Pretendard', fontSize: 15, padding: 0 },
  error: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13, marginTop: 10 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 22 },
  button: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  cancel: { backgroundColor: palette.bgSoft },
  cancelText: { fontSize: 15, fontWeight: '700', color: palette.textDim },
  save: { backgroundColor: palette.blue },
  saveOff: { opacity: 0.5 },
  saveText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
