import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { PrimaryButton } from '@/components/ui/buttons';
import { translate as t } from '@/lib/i18n';

/**
 * pen 「⑧ 새 연습 · 영상 올리는 중」(SOMA-817) — 영상이 다 올라가기를 기다리는 한 장.
 * 올리기 큐는 진행률 숫자를 주지 않아 막대는 단계로만 채운다(올리는 중 절반·실패 비움). 나가도 계속 올라간다.
 */
export function UploadWaitPanel({
  failed,
  onHome,
  onRetry,
  onCancel,
}: {
  failed: boolean;
  onHome: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {!failed && <ActivityIndicator color={palette.blue} />}
        <Text style={styles.title}>{failed ? t('upload.waitFailedBody') : t('upload.waitTitle')}</Text>
        {!failed && <Text style={styles.sub}>{t('upload.waitBody')}</Text>}
        <View style={styles.track} accessibilityRole="progressbar">
          <View style={[styles.fill, failed && styles.fillFailed]} />
        </View>
      </View>
      <View style={styles.footer}>
        {failed ? (
          <PrimaryButton label={t('upload.waitRetry')} onPress={onRetry} />
        ) : (
          <PrimaryButton label={t('upload.waitHome')} onPress={onHome} />
        )}
        <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>{t('upload.waitCancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  title: { fontSize: 21, fontWeight: '800', color: palette.text, textAlign: 'center' },
  sub: { fontSize: 15, color: palette.textDim, textAlign: 'center' },
  track: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: palette.bgSoft, overflow: 'hidden', marginTop: 8 },
  fill: { width: '50%', height: 8, borderRadius: 4, backgroundColor: palette.blue },
  fillFailed: { width: 0 },
  footer: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  cancel: { height: 52, borderRadius: 16, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700', color: palette.textDim },
});
