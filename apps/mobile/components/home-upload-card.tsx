import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import type { useWaitingUpload } from '@/hooks/use-waiting-upload';
import { translate as t } from '@/lib/i18n';

/**
 * 홈 맨 위 「영상 올리는 중」 카드(pen 「② 일반 홈 · 영상 올리는 중」, SOMA-817). 올리는 중이거나 올린 뒤 코칭을 시작하기 전,
 * 올리기에 실패했을 때만 나온다 — 없으면 아무것도 그리지 않는다. 홈은 `upload` 가 있으면 이 카드로 「오늘 할 것」을 대신한다.
 */
export function HomeUploadCard({ upload }: { upload: ReturnType<typeof useWaitingUpload> }) {
  const { card, error, busy, retry, begin } = upload;
  if (!card) return null;
  const { state, waiting } = card;
  const title = waiting.scene.situation.trim() || t('home.uploadTitle');
  const eyebrow =
    state === 'ready' ? t('home.uploadReadyEyebrow') : state === 'failed' ? t('home.uploadFailedEyebrow') : t('home.uploadEyebrow');
  const sub = state === 'failed' ? t('home.uploadFailedSub') : t('home.uploadSub');
  const cta = state === 'ready' ? t('home.uploadReadyCta') : state === 'failed' ? t('home.uploadFailedCta') : t('home.uploadCta');
  const bar = state === 'ready' ? '100%' : state === 'failed' ? '0%' : '50%';
  const press = state === 'ready' ? begin : state === 'failed' ? retry : undefined;
  return (
    <View style={styles.card} testID="home-upload-card">
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title} numberOfLines={3}>{title}</Text>
      <Text style={styles.sub}>{error ?? sub}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: bar }]} />
      </View>
      <Pressable
        onPress={() => void press?.()}
        disabled={!press || busy}
        accessibilityRole="button"
        accessibilityLabel={cta}
        style={({ pressed }) => [styles.cta, (!press || busy) && styles.ctaOff, pressed && styles.pressed]}>
        <Text style={styles.ctaText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 24, backgroundColor: palette.blueSoft, borderRadius: 22, padding: 20, gap: 10 },
  eyebrow: { fontSize: 13, fontWeight: '700', color: palette.blueDeep },
  title: { fontSize: 21, fontWeight: '800', lineHeight: 28, color: palette.text },
  sub: { fontSize: 13, fontWeight: '600', lineHeight: 20, color: palette.textDim },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: palette.blue },
  cta: { height: 52, borderRadius: 16, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontSize: 16, fontWeight: '800', color: palette.onAccent },
  pressed: { opacity: 0.85 },
});
