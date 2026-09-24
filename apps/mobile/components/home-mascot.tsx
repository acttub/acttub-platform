import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { mascotLine } from '@/lib/mascot-lines';

/**
 * 모습이 여럿이면 날마다 돌아가며 나온다. 지금은 한 장이다 — 그림이 생기면 여기에 더한다.
 */
const MASCOTS = [require('@/assets/images/mascot-home.png')];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 기기 시간대 기준 오늘이 몇 번째 날인지 — 하루 동안은 같은 말을 한다. */
function localDayIndex(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY_MS);
}

/**
 * 홈 히어로의 캐릭터 (SOMA-494). 늘 같은 말·같은 자세면 멈춘 그림 같아서 — 말풍선이 날마다·시간대마다
 * 바뀌고, 캐릭터가 천천히 숨 쉬듯 떠 있으며, 누르면 폴짝 뛰고 다음 말을 한다.
 */
export function HomeMascot({ streak }: { streak: number }) {
  const [taps, setTaps] = useState(0);
  const now = new Date();
  const dayIndex = localDayIndex(now);
  const line = mascotLine({ hour: now.getHours(), dayIndex, streak, taps });
  const source = MASCOTS[dayIndex % MASCOTS.length];

  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);
  const hop = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    float.value = withRepeat(withTiming(-4, { duration: 1600, easing: easing.standard }), -1, true);
  }, [float, reduceMotion]);

  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: float.value + hop.value }] }));

  const poke = () => {
    setTaps((n) => n + 1);
    if (reduceMotion) return;
    hop.value = withSequence(
      withTiming(-14, { duration: motion.fast, easing: easing.enter }),
      withSpring(0, { damping: 9, stiffness: 220 }),
    );
  };

  return (
    <View style={styles.col}>
      <Animated.View key={line} entering={reduceMotion ? undefined : FadeIn.duration(motion.standard)} style={styles.bubble}>
        <Text style={styles.bubbleText}>{line}</Text>
      </Animated.View>
      <Pressable onPress={poke} accessibilityRole="button" accessibilityLabel={t('home.mascotA11y')}>
        <Animated.View style={bodyStyle}>
          <Image source={source} style={styles.mascot} resizeMode="contain" />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: 118, alignItems: 'center', gap: 4 },
  bubble: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleText: { fontSize: 11.5, fontWeight: '700', color: palette.textDim, textAlign: 'center', lineHeight: 16 },
  mascot: { width: 96, height: 108 },
});
