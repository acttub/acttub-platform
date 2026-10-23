import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { MASCOT } from '@/components/ui/mascot';
import { PrimaryButton } from '@/components/ui/buttons';
import { translate as t } from '@/lib/i18n';

/**
 * pen P3.2·P3.24 「⑧ 새 연습 · 영상 올리는 중」(SOMA-817) — 영상이 다 올라가기를 기다리는 한 장.
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
        <Image source={MASCOT.coach} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{failed ? t('upload.waitFailedTitle') : t('upload.waitTitle')}</Text>
        <Text style={styles.sub}>{failed ? t('upload.waitFailedSub') : t('upload.waitBody')}</Text>
        {!failed && (
          <View style={styles.track} accessibilityRole="progressbar">
            <View style={styles.fill} />
          </View>
        )}
      </View>
      <View style={styles.footer}>
        {failed ? (
          <PrimaryButton label={t('upload.waitRetry')} onPress={onRetry} />
        ) : (
          <PrimaryButton label={t('upload.waitHome')} onPress={onHome} />
        )}
        <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>{failed ? t('upload.waitLater') : t('upload.waitCancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 16, paddingHorizontal: 24 },
  mascot: { width: 84, height: 94 },
  title: { alignSelf: 'stretch', fontSize: 21, fontWeight: '800', lineHeight: 30, color: palette.text, textAlign: 'center' },
  sub: { alignSelf: 'stretch', fontSize: 15, lineHeight: 22, color: palette.textDim, textAlign: 'center' },
  track: { width: 240, height: 8, borderRadius: 4, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { width: '50%', height: 8, borderRadius: 4, backgroundColor: palette.blue },
  footer: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 13, gap: 8 },
  cancel: { height: 52, borderRadius: 14, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700', lineHeight: 23, color: palette.textStrong },
});
