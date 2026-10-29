import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
  const action =
    state === 'ready' ? { cta: t('home.uploadReadyCta'), press: begin } : state === 'failed' ? { cta: t('home.uploadFailedCta'), press: retry } : null;
  return (
    <View style={styles.card} testID="home-upload-card">
      <View style={styles.eyebrowRow}>
        {/* pen P1 「영상 올리는 중」 — 올리는 동안은 올리기 아이콘, 다 올렸거나 실패하면 영상 아이콘. */}
        <Feather name={state === 'uploading' ? 'upload' : 'video'} size={16} color={palette.onAccent} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.title} numberOfLines={3}>{title}</Text>
      <Text style={styles.sub}>{error ?? sub}</Text>
      {action ? (
        <Pressable
          onPress={() => void action.press()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={action.cta}
          style={({ pressed }) => [styles.cta, busy && styles.ctaOff, pressed && styles.pressed]}>
          <Text style={styles.ctaText}>{action.cta}</Text>
          <Feather name="arrow-right" size={16} color={palette.blueDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 홈 「오늘 할 것」 카드와 같은 모양 — text 바탕 r16, 안쪽 20, 흰 글자, 흰 버튼(md 40). 진행률을 받지 않아 막대는 두지 않는다. */
const styles = StyleSheet.create({
  card: { backgroundColor: palette.text, borderRadius: radius.lg, padding: space[5], gap: space[2] },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  eyebrow: { ...type.caption, color: palette.onMediaSub },
  title: { ...type.title2, color: palette.onAccent },
  sub: { ...type.caption, color: palette.onMediaSub },
  cta: {
    alignSelf: 'flex-start',
    marginTop: space[2],
    height: 40,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    backgroundColor: palette.bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { ...type.body2Bold, color: palette.blueDeep },
  pressed: { opacity: 0.85 },
});
