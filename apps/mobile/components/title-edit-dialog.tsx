import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
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
      {/* 키보드가 뜨면 키보드 위 남은 칸 가운데에 놓여 입력칸과 버튼이 가리지 않는다. */}
      <KeyboardLift>
        <Pressable style={styles.backdrop} onPress={() => !busy && onClose(false)} testID="title-edit-backdrop">
          <Pressable style={styles.stop} onPress={(e) => e.stopPropagation()}>
            <DialogCard title={t('reading.titleEdit')}>
              <View style={styles.field}>
                <TextField
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t('reading.untitled')}
                  accessibilityLabel={t('reading.titleEdit')}
                  error={failed ? t('reading.titleSaveFail') : null}
                  style={styles.input}
                  autoFocus
                />
                {!!title && (
                  <Pressable style={styles.clear} hitSlop={8} onPress={() => setTitle('')} accessibilityRole="button" accessibilityLabel={t('common.close')} ph-label="title_edit_clear">
                    <Feather name="x" size={18} color={palette.iconFaint} />
                  </Pressable>
                )}
              </View>
              <DialogButtons
                cancelLabel={t('common.cancel')}
                onCancel={() => onClose(false)}
                confirmLabel={t('common.save')}
                onConfirm={() => void save()}
                confirmDisabled={!changed}
                busy={busy}
                busyLabel={t('loadingText.saving')}
              />
            </DialogCard>
          </Pressable>
        </Pressable>
      </KeyboardLift>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space.gutter },
  stop: { width: '100%', alignItems: 'center' },
  field: { paddingTop: space[2] },
  input: { paddingRight: space[10] },
  // 입력칸(48) 안 오른쪽 끝 — 오류 줄이 아래에 붙어도 칸 위에 머문다.
  clear: { position: 'absolute', top: space[2], right: 0, width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
});
