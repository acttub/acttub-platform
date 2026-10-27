import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InfoBanner } from '@/components/ui/info-banner';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

/**
 * 「새 연습 · 영상 올리는 중」(SOMA-817, pen upload.wait-panel) — 영상이 다 올라가기를 기다리는 한 장.
 * 버튼은 없다. 뒤로 가면 기다리는 업로드로 남기고 홈으로 나간다. 올리기 큐가 진행률을 주지 않아 막대도 없다.
 * 실패하면 StatusScreen 오류 틀에 아래 바 「나중에 할게요」(뒤로 가기와 같은 길) 위 · 「다시 올리기」 아래.
 */
export function UploadWaitPanel({ failed, onLater, onRetry }: { failed: boolean; onLater: () => void; onRetry: () => void }) {
  if (failed) {
    return (
      <View style={styles.root}>
        <StatusScreen title={t('upload.waitFailedTitle')} body={t('upload.waitFailedSub')} />
        <CtaBar safeBottom={false}>
          <TextButton label={t('upload.waitLater')} phLabel="upload_wait_later" onPress={onLater} />
          <PrimaryButton label={t('upload.waitRetry')} phLabel="upload_wait_retry" onPress={onRetry} />
        </CtaBar>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <Image source={MASCOT.coach} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{t('upload.waitTitle')}</Text>
        <Text style={styles.sub}>{t('upload.waitBody')}</Text>
      </View>
      <View style={styles.footer}>
        {/* 광고 칸(SOMA-876) — 연습 중 칸, 아래 안내 바로 위. */}
        <AdSlot slot="upload_wait" />
        <InfoBanner title={t('upload.waitLeaveTitle')} body={t('upload.waitLeaveBody')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[2], paddingHorizontal: space.gutter },
  title: { ...type.title2, color: palette.text, textAlign: 'center' },
  sub: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  footer: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[3], gap: space[2] },
});
