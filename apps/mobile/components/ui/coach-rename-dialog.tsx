import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
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
      {/* 키보드가 뜨면 키보드 위 남은 칸에서 다시 가운데·아래에 놓여 입력칸과 버튼이 가리지 않는다. */}
      <KeyboardLift>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={[styles.input, failed && styles.inputBad]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={palette.textMeta}
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
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  // pen 「추가 · 제목 바꾸기」(ioeo9w) — 카드 334 · 모서리 22 · 안쪽 [24,20,20,20] · 간격 12, 제목 18/800, 칸 모서리 12 · 높이 50 · 16/700.
  card: { width: '100%', maxWidth: 334, backgroundColor: palette.bg, borderRadius: 22, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '800', lineHeight: 27, color: palette.text },
  input: {
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.bgSoft,
    minHeight: 50,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
  },
  inputBad: { borderColor: palette.danger },
  hint: { fontSize: 13, fontWeight: '600', lineHeight: 20, color: palette.textMeta },
  fail: { color: palette.danger },
});
