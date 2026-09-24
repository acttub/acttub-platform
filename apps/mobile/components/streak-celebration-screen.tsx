import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  SlideInDown,
  SlideOutUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { CelebrationDot } from '@/lib/streak-celebration';

/** 불꽃이 자리 잡은 뒤 숫자가 바뀌는 때. */
const COUNT_AT = 650;
/** 숫자가 바뀐 뒤 오늘 칸이 차오르는 때. */
const FILL_AT = COUNT_AT + 350;

/**
 * 연속일이 늘어난 순간 화면을 꽉 채워 축하한다 (SOMA-494, 듀오링고식).
 *
 * <p>UI 가이드는 과한 연출(dramatic reveal·스프링)을 막지만, 연속일 축하는 코칭 결과가 아니라
 * 습관 보상이라 예외로 둔다(docs/design/UI_GUIDE.md). 그래도 글로우·그라데이션 흐름은 쓰지 않는다.
 *
 * <p>순서: 불꽃이 튀어 오르며 등장 → 숫자가 어제 값에서 오늘 값으로 바뀐다(옛 숫자는 위로 빠지고
 * 새 숫자가 아래에서 올라온다 — 숫자를 겹쳐 흐리면 깜빡이는 버그처럼 보인다) → 햅틱 → 이번 주
 * 요일 점 중 오늘 칸이 차오른다 → 문구와 "계속하기". 기기에서 "동작 줄이기"를 켜 두면
 * reanimated 가 움직임 없이 끝 상태로 보여 준다.
 */
export function StreakCelebrationScreen({
  streak,
  dots,
  onDone,
}: {
  streak: number;
  dots: CelebrationDot[];
  onDone: () => void;
}) {
  const [shown, setShown] = useState(Math.max(0, streak - 1));
  const flame = useSharedValue(0);
  const fill = useSharedValue(0);

  useEffect(() => {
    flame.value = withSequence(
      withSpring(1.15, { damping: 7, stiffness: 180 }),
      withSpring(1, { damping: 12, stiffness: 160 }),
    );
    fill.value = withDelay(FILL_AT, withSpring(1, { damping: 9, stiffness: 200 }));
    const timer = setTimeout(() => {
      setShown(streak);
      try {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // 햅틱 미지원 기기는 조용히 넘어간다.
      }
    }, COUNT_AT);
    return () => clearTimeout(timer);
  }, [fill, flame, streak]);

  const flameStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, flame.value * 1.5),
    transform: [{ scale: flame.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scale: fill.value }] }));

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <SafeAreaView style={styles.safe} accessibilityLabel={t('home.streakScreenA11y', { days: streak })}>
        <View style={styles.center}>
          <Animated.Text style={[styles.flame, flameStyle]}>🔥</Animated.Text>

          <View style={styles.countBox}>
            <Animated.Text
              key={shown}
              style={styles.count}
              entering={SlideInDown.duration(motion.standard).easing(easing.enter)}
              exiting={SlideOutUp.duration(motion.fast).easing(easing.exit)}>
              {shown}
            </Animated.Text>
          </View>
          <Animated.Text entering={FadeIn.delay(200).duration(motion.standard)} style={styles.unit}>
            {t('home.streakScreenUnit')}
          </Animated.Text>

          <View style={styles.week}>
            {dots.map((dot, i) => (
              <Animated.View
                key={dot.key}
                style={styles.dayCol}
                entering={FadeInDown.delay(300 + i * 50).duration(motion.standard).easing(easing.enter)}>
                <Text style={[styles.dayLabel, dot.state === 'today' && styles.dayLabelToday]}>{dot.label}</Text>
                <View style={[styles.dot, dot.state === 'done' && styles.dotDone]}>
                  {dot.state === 'today' && <Animated.View style={[styles.dotFill, fillStyle]} />}
                  {dot.state !== 'empty' && (
                    <Animated.Text
                      style={styles.check}
                      entering={dot.state === 'today' ? FadeIn.delay(FILL_AT + 120) : undefined}>
                      ✓
                    </Animated.Text>
                  )}
                </View>
              </Animated.View>
            ))}
          </View>

          <Animated.Text entering={FadeIn.delay(FILL_AT + 200).duration(motion.slow)} style={styles.next}>
            {streak === 1
              ? `${t('home.streakScreenFirst')}\n${t('home.streakScreenNext', { next: streak + 1 })}`
              : t('home.streakScreenNext', { next: streak + 1 })}
          </Animated.Text>
        </View>

        <Animated.View entering={FadeInDown.delay(FILL_AT + 300).duration(motion.standard).easing(easing.enter)}>
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            onPress={onDone}
            accessibilityRole="button">
            <Text style={styles.ctaText}>{t('home.streakScreenCta')}</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const DOT = 34;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.flame, paddingHorizontal: 24, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flame: { fontSize: 120, lineHeight: 140 },
  countBox: { height: 112, overflow: 'hidden', justifyContent: 'center', marginTop: 4 },
  count: {
    fontSize: 96,
    lineHeight: 112,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', marginTop: 2 },
  week: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  dayCol: { alignItems: 'center', gap: 8 },
  dayLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255, 255, 255, 0.8)' },
  dayLabelToday: { color: '#FFFFFF', fontWeight: '900' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dotDone: { backgroundColor: '#FFFFFF' },
  dotFill: { ...StyleSheet.absoluteFillObject, borderRadius: DOT / 2, backgroundColor: '#FFFFFF' },
  check: { fontSize: 16, fontWeight: '900', color: palette.flameDeep },
  next: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 28,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
  },
  pressed: { opacity: 0.9 },
  ctaText: { fontSize: 17, fontWeight: '900', color: palette.flameDeep },
});
