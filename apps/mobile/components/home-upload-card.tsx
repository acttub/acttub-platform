import Feather from '@expo/vector-icons/Feather';
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
      <View style={styles.eyebrowRow}>
        {/* pen P1 「영상 올리는 중」 — 올리는 동안은 올리기 아이콘, 다 올렸거나 실패하면 영상 아이콘. */}
        <Feather name={state === 'uploading' ? 'upload' : 'video'} size={16} color={palette.onAccent} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.title} numberOfLines={3}>{title}</Text>
      <Text style={styles.sub}>{error ?? sub}</Text>
      {/* pen 「틈」 1×2 — 막대·버튼은 부연 바로 아래에 붙는다. */}
      <View style={styles.spacer} />
      {press ? (
        <Pressable
          onPress={() => void press()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={cta}
          style={({ pressed }) => [styles.cta, busy && styles.ctaOff, pressed && styles.pressed]}>
          <Text style={styles.ctaText}>{cta}</Text>
          <Feather name="arrow-right" size={16} color={palette.blue} />
        </Pressable>
      ) : (
        <View style={styles.track} accessibilityLabel={cta}>
          <View style={[styles.fill, { width: bar }]} />
        </View>
      )}
    </View>
  );
}

/** 올리는 중 카드(pen 「P1 신규 · 일반 홈 · 영상 올리는 중」) — 추천 연습 카드와 같은 어두운 바탕에 진행 막대. */
const styles = StyleSheet.create({
  card: {
    minHeight: 196,
    backgroundColor: '#202121',
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 8,
    overflow: 'hidden',
    shadowColor: '#2F6EF2',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { fontSize: 13, fontWeight: '600', lineHeight: 18, color: 'rgba(255,255,255,0.9)' },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.onAccent, maxWidth: 260 },
  sub: { fontSize: 12, fontWeight: '400', lineHeight: 18, color: 'rgba(255,255,255,0.8)' },
  spacer: { height: 2 },
  track: { height: 8, width: 200, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: palette.onAccent },
  cta: { alignSelf: 'flex-start', height: 42, borderRadius: 21, paddingHorizontal: 22, backgroundColor: palette.onAccent, flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontSize: 15, fontWeight: '800', color: palette.blue },
  pressed: { opacity: 0.85 },
});
