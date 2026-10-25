import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { easing } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 뼈대 화면(SOMA-828). 화면을 열 때 데이터를 기다리는 동안 로딩 표시 대신
 * 실제 내용과 비슷한 모양의 회색 칸을 은은하게 깜빡이며 보여 준다.
 * - 버튼을 누른 뒤 기다릴 때는 이것이 아니라 LoadingText(문구)를 쓴다.
 * - 화면마다 실제 배치와 비슷한 프리셋(SkeletonRows·SkeletonCards·SkeletonDetail)을 고르고,
 *   맞는 게 없으면 SkeletonBlock 으로 직접 짠다.
 */

const PULSE_MS = 900;

/** 회색 칸 하나. 너비·높이·모서리를 정한다. */
export function SkeletonBlock({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: PULSE_MS, easing: easing.standard }), -1, true);
  }, [opacity, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, animated, style]} />;
}

/** 뼈대 묶음의 바깥 틀. 화면 낭독기에는 「불러오는 중」 하나로 읽힌다. */
export function SkeletonGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loadingText.loading')}
      testID="skeleton">
      {children}
    </View>
  );
}

/**
 * 목록 줄 뼈대(알림·기록·차단 목록·설정처럼 한 줄씩 쌓이는 화면).
 * avatar: 줄 앞 동그라미(프로필·아이콘). card: 줄마다 흰 카드로 감쌀지.
 */
export function SkeletonRows({
  count = 5,
  avatar = true,
  card = true,
  style,
}: {
  count?: number;
  avatar?: boolean;
  card?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SkeletonGroup style={[styles.rows, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, card && styles.card]}>
          {avatar && <SkeletonBlock width={40} height={40} radius={20} />}
          <View style={styles.rowLines}>
            <SkeletonBlock width={i % 2 === 0 ? '78%' : '64%'} height={13} />
            <SkeletonBlock width={i % 2 === 0 ? '46%' : '54%'} height={11} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

/**
 * 카드·타일 뼈대(챌린지·영상·오디션처럼 썸네일이 있는 화면).
 * columns: 한 줄 칸 수. aspectRatio: 썸네일 가로/세로 비(세로 영상이면 9/16).
 */
export function SkeletonCards({
  count = 4,
  columns = 2,
  aspectRatio = 9 / 16,
  caption = true,
  style,
}: {
  count?: number;
  columns?: number;
  aspectRatio?: number;
  caption?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const basis = `${(100 - (columns - 1) * 3) / columns}%` as DimensionValue;
  return (
    <SkeletonGroup style={[styles.cards, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.cardCell, { width: basis }]}>
          <SkeletonBlock height="auto" radius={14} style={{ aspectRatio }} />
          {caption && (
            <>
              <SkeletonBlock width="80%" height={12} />
              <SkeletonBlock width="50%" height={10} />
            </>
          )}
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** 상세 화면 뼈대(제목 + 큰 칸 + 본문 몇 줄). media: 위쪽 큰 칸(영상·이미지)을 넣을지. */
export function SkeletonDetail({ media = false, lines = 4, style }: { media?: boolean; lines?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <SkeletonGroup style={[styles.detail, style]}>
      {media && <SkeletonBlock height={200} radius={16} />}
      <SkeletonBlock width="62%" height={22} radius={8} />
      <SkeletonBlock width="38%" height={13} />
      <View style={styles.detailBody}>
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonBlock key={i} width={i === lines - 1 ? '58%' : '100%'} height={13} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: palette.border },
  rows: { gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  card: { backgroundColor: palette.bg, borderRadius: 16, padding: 14 },
  rowLines: { flex: 1, gap: 8 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18, paddingHorizontal: 20, paddingVertical: 16 },
  cardCell: { gap: 8 },
  detail: { gap: 12, paddingHorizontal: 20, paddingVertical: 20 },
  detailBody: { gap: 9, marginTop: 8 },
});
