import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/buttons';
import { DialogCard, DialogModal } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/tokens';
import { updateScriptMeta } from '@/lib/reading/store';
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
    // 이름을 받으려는 창이라 바깥을 눌러 닫지 않는다. 안드로이드 뒤로 가기로 닫으면 임시 이름 그대로 둔다.
    <DialogModal onRequestClose={() => !busy && onClose()}>
      <DialogCard title={t('reading.monologueNameTitle')} message={t('reading.monologueNameBody')}>
        <View style={styles.form}>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder={t('reading.monologueNamePlaceholder')}
            accessibilityLabel={t('reading.monologueNamePlaceholder')}
            error={failed ? t('reading.titleSaveFail') : null}
            autoFocus
          />
          <PrimaryButton
            label={t('reading.monologueNameSave')}
            disabled={!next}
            loading={busy}
            loadingLabel={t('loadingText.saving')}
            onPress={() => void save()}
          />
        </View>
      </DialogCard>
    </DialogModal>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4], paddingTop: space[4] },
});
