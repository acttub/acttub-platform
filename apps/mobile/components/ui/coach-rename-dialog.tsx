import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * 연습 제목 바꾸기(pen practice-group.rename) — Dialog 안 TextField, 아래 안내 한 줄(실패하면 칸 아래 InlineError/Line), 취소·저장.
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
          <Pressable style={styles.stop} onPress={(e) => e.stopPropagation()}>
            <DialogCard title={title}>
              <TextField
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                maxLength={maxLength}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void save()}
                error={failed ? failText : null}
              />
              {failed ? null : <Text style={styles.hint}>{hint}</Text>}
              <DialogButtons
                cancelLabel={cancelLabel}
                onCancel={onClose}
                confirmLabel={saveLabel}
                onConfirm={() => void save()}
                busy={busy}
              />
            </DialogCard>
          </Pressable>
        </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  stop: { width: '100%', alignItems: 'center' },
  hint: { ...type.caption, color: palette.textMeta },
});
