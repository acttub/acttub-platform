import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 홈 상단 연속일 배지 (SOMA-479, 듀오링고식).
 *
 * 늘 보이게 상단에 둔다 — 연속일이 눈앞에 있어야 "끊기기 싫다"가 생긴다.
 * 0일이면 회색으로 죽여 두고, 1일부터 불꽃 색으로 살린다.
 * celebrate 가 켜지면 한 번 통 튀어오르며 햅틱을 준다(늘어난 순간에만).
 */
export function StreakBadge({
  streak,
  celebrate,
  onPress,
}: {
  streak: number;
  celebrate: boolean;
  onPress?: () => void;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!celebrate) return;
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // 햅틱 미지원 기기는 조용히 넘어간다.
    }
    scale.value = withSequence(
      withTiming(1.35, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 260, easing: Easing.elastic(1.4) }),
    );
  }, [celebrate, scale]);

  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const active = streak >= 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? t('home.streakBadgeA11y', { days: streak }) : t('home.streakBadgeZero')}
      style={[styles.badge, active ? styles.badgeActive : styles.badgeIdle]}>
      <Animated.Text style={[styles.flame, flameStyle, !active && styles.flameIdle]}>🔥</Animated.Text>
      <Text style={[styles.count, active ? styles.countActive : styles.countIdle]}>{streak}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeActive: { backgroundColor: palette.flameSoft, borderColor: palette.flame },
  badgeIdle: { backgroundColor: palette.bgSoft, borderColor: palette.border },
  flame: { fontSize: 17 },
  flameIdle: { opacity: 0.4 },
  count: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  countActive: { color: palette.flameDeep },
  countIdle: { color: palette.checkOff },
});
