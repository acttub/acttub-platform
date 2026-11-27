import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import type { PracticeProgress } from '@/lib/practice/coaching-progress';

/** 점마다 채우기 시작을 이만큼 늦춘다 — 왼쪽부터 하나씩 찬다(이번 주 연습 카드와 같은 방식). */
const DOT_STAGGER_MS = 80;

/**
 * 장면 카드의 「n/3번 해 봤어요」와 진행 점(SOMA-810). 점은 목표 수만큼이고 채운 점은 해 본 횟수만큼(목표를 넘으면 다 채운다).
 * 처음 보일 때 빈 점에서 하나씩 짧게 채워지고, 「동작 줄이기」면 바로 채운 모양이다.
 */
export function PracticeProgressDots({ progress }: { progress: PracticeProgress }) {
  return (
    <View style={styles.row} testID="coaching-progress" accessible accessibilityLabel={progress.label}>
      <View style={styles.dots}>
        {Array.from({ length: progress.goal }, (_, i) => (
          <View key={i} style={styles.dot} testID={i < progress.filled ? 'coaching-progress-dot-on' : 'coaching-progress-dot-off'}>
            {i < progress.filled && <DotFill delay={i * DOT_STAGGER_MS} />}
          </View>
        ))}
      </View>
      <Text style={styles.label}>{progress.label}</Text>
    </View>
  );
}

function DotFill({ delay }: { delay: number }) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    fill.value = reduceMotion ? 1 : withDelay(delay, withTiming(1, { duration: motion.fast, easing: easing.enter }));
  }, [delay, reduceMotion, fill]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: fill.value }] }));
  return <Animated.View style={[styles.fill, fillStyle]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dots: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  dot: { width: space[2], height: space[2], borderRadius: radius.full, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: radius.full, backgroundColor: palette.blue },
  label: { ...type.captionBold, color: palette.textSub },
});
