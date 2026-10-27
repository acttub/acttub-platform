import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { palette } from '@/constants/palette';
import { MASCOT } from '@/components/ui/mascot';
import { PrimaryButton } from '@/components/ui/buttons';
import { InfoBanner } from '@/components/ui/info-banner';
import { translate as t } from '@/lib/i18n';

/**
 * pen P3.2·P3.24 「⑧ 새 연습 · 영상 올리는 중」(SOMA-817) — 영상이 다 올라가기를 기다리는 한 장.
 * 버튼은 없다. 뒤로 가면 기다리는 업로드로 남기고 코칭 탭으로 나간다(10-27 정함). 올리기 큐가 진행률을 주지 않아 막대도 없다.
 * 실패하면 「나중에 할게요」(뒤로 가기와 같은 길)와 「다시 올리기」.
 */
export function UploadWaitPanel({ failed, onLater, onRetry }: { failed: boolean; onLater: () => void; onRetry: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <Image source={MASCOT.coach} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{failed ? t('upload.waitFailedTitle') : t('upload.waitTitle')}</Text>
        <Text style={styles.sub}>{failed ? t('upload.waitFailedSub') : t('upload.waitBody')}</Text>
      </View>
      {failed ? (
        <View style={styles.footer}>
          <Pressable style={styles.cancel} onPress={onLater} accessibilityRole="button">
            <Text style={styles.cancelText}>{t('upload.waitLater')}</Text>
          </Pressable>
          <PrimaryButton label={t('upload.waitRetry')} onPress={onRetry} />
        </View>
      ) : (
        <View style={styles.footer}>
          {/* 광고 칸(SOMA-876) — 연습 중 칸, 아래 안내 바로 위. */}
          <AdSlot slot="upload_wait" />
          <InfoBanner title={t('upload.waitLeaveTitle')} body={t('upload.waitLeaveBody')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 16, paddingHorizontal: 24 },
  mascot: { width: 84, height: 94 },
  title: { alignSelf: 'stretch', fontSize: 21, fontWeight: '800', lineHeight: 30, color: palette.text, textAlign: 'center' },
  sub: { alignSelf: 'stretch', fontSize: 15, lineHeight: 22, color: palette.textSub, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 13, gap: 8 },
  cancel: { height: 52, borderRadius: 14, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700', lineHeight: 23, color: palette.text },
});
