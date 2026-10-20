import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { DialogButtons } from '@/components/ui/dialog';
import { palette } from '@/constants/palette';

/**
 * 연습 제목 바꾸기(pen 「추가 · 제목 바꾸기」, SOMA-748) — 가운데 카드, 회색 입력칸, 아래 안내 한 줄, 취소·저장.
 * 저장은 여는 쪽이 한다(`onSave`가 끝나면 닫고, 던지면 실패 문구를 보인다).
 */
export function RenameDialog({
  visible,
  title,
  initial,
  placeholder,
  hint,
  failText,
  cancelLabel,
  saveLabel,
  maxLength,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  placeholder: string;
  hint: string;
  failText: string;
  cancelLabel: string;
  saveLabel: string;
  maxLength: number;
  onSave: (next: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValue(initial);
    setFailed(false);
  }, [visible, initial]);

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onSave(value.trim());
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent statusBarTranslucent visible={visible} animationType="fade" onRequestClose={() => !busy && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={[styles.input, failed && styles.inputBad]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={palette.textFaint}
            maxLength={maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Text style={[styles.hint, failed && styles.fail]}>{failed ? failText : hint}</Text>
          <DialogButtons
            cancelLabel={cancelLabel}
            onCancel={onClose}
            confirmLabel={saveLabel}
            onConfirm={() => void save()}
            busy={busy}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 340, backgroundColor: palette.card, borderRadius: 24, padding: 20, gap: 12 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.bgSoft,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: '700',
    color: palette.text,
  },
  inputBad: { borderColor: palette.danger },
  hint: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  fail: { color: palette.danger },
});
