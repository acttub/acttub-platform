import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/** P3.27 올리기 — 압축 실패. 「다시 시도」는 올리기 큐를 다시 밀고, 「다른 영상 고르기」는 이 영상을 버리고 고르기로 돌아간다. */
export function UploadPrepareFailed({ onRetry, onOther }: { onRetry: () => void; onOther: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.title}>{t('uploadFlow.failTitle')}</Text>
        <Text style={styles.sub}>{t('uploadFlow.failBody')}</Text>
      </View>
      <View style={styles.bottom}>
        <PrimaryButton label={t('uploadFlow.retry')} phLabel="upload_prepare_retry" onPress={onRetry} />
        <SecondaryButton label={t('uploadFlow.other')} phLabel="upload_prepare_other" onPress={onOther} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.text, textAlign: 'center' },
  sub: { fontSize: 15, fontWeight: '500', lineHeight: 22, color: palette.textMeta, textAlign: 'center' },
  bottom: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, gap: 8 },
});
