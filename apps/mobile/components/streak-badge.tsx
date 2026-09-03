import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
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

/**
 * 연속일이 늘어난 순간 한 번 뜨는 축하 배너. onDone 후 스스로 사라진다.
 * 화면을 막지 않게 상단에 떠서 흐르는(fade+slide) 형태로 둔다.
 */
export function StreakCelebration({ streak, onDone }: { streak: number; onDone: () => void }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-12);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: 240 }),
      withDelay(1900, withTiming(0, { duration: 320 })),
    );
    translateY.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.back(1.4)) });
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [opacity, translateY, onDone]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.toast, style]} pointerEvents="none">
      <Text style={styles.toastTitle}>{t('home.streakCelebrateTitle', { days: streak })}</Text>
      <Text style={styles.toastSub}>{t('home.streakCelebrateSub')}</Text>
    </Animated.View>
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
  toast: {
    position: 'absolute',
    top: 8,
    left: 20,
    right: 20,
    backgroundColor: palette.navy,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 20,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toastTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  toastSub: { color: '#D5DBE3', fontSize: 13, marginTop: 2 },
});
