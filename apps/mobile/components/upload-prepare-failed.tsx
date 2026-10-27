import { StyleSheet, View } from 'react-native';

import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 올리기 — 압축 실패. 「다시 시도」는 올리기 큐를 다시 밀고, 「다른 영상 고르기」는 이 영상을 버리고 고르기로 돌아간다.
 * StatusScreen 오류 틀 + 아래 바(보조 글자 버튼 위 · 주 버튼 아래).
 */
export function UploadPrepareFailed({ onRetry, onOther }: { onRetry: () => void; onOther: () => void }) {
  return (
    <View style={styles.root}>
      <StatusScreen title={t('uploadFlow.failTitle')} body={t('uploadFlow.failBody')} />
      <CtaBar safeBottom={false}>
        <TextButton label={t('uploadFlow.other')} phLabel="upload_prepare_other" onPress={onOther} />
        <PrimaryButton label={t('uploadFlow.retry')} phLabel="upload_prepare_retry" onPress={onRetry} />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
});
