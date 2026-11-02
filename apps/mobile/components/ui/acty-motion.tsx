import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';

/**
 * 움직이는 액티.
 * - celebrate: 완료 화면. 그 화면 자세로 바로 튀어나와 두 번 폴짝 뛰고(착지 때 살짝 눌림),
 *   놀란 자세를 먼저 보이지 않는다(11/2 QA — 「경악하다가 웃는」 게 어색하다). intro 를 넘길 때만 그 자세를 먼저 깐다.
 *   그 뒤로는 천천히 숨 쉬듯 떠 있다.
 * - think: 코치가 답을 생각하는 동안. 갸웃 자세가 좌우로 고개를 기울이며 살짝 떠 있다.
 * - none: 멈춘 그림(예: 「연습으로 안 셌어요」처럼 축하할 일이 아닌 완료).
 * 기기에서 「동작 줄이기」를 켜 두면 끝 자세만 멈춘 채로 보인다. 크기는 받은 그대로라 화면 배치가 바뀌지 않는다.
 */
export type ActyMotionKind = 'celebrate' | 'think' | 'none';

/** intro 자세를 보여 주는 시간 — 그 뒤 화면 자세로 바뀐다(intro 를 넘길 때만). */
export const ACTY_INTRO_MS = 420;
const HOP_UP = 170;
const HOP_DOWN = 170;
const HOP_GAP = 60;
/** 자세 바꿈 — 길면 두 그림이 겹쳐 보여 짧게 한다. */
const SWAP_MS = 80;

export function ActyMotion({
  source,
  size,
  kind,
  intro,
  testID,
}: {
  source: ImageSourcePropType;
  size: { width: number; height: number };
  kind: ActyMotionKind;
  /** celebrate 가 처음 잠깐 보여 주는 자세. 기본은 없음 — 화면 자세로 바로 시작한다. */
  intro?: ImageSourcePropType;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  const animate = kind !== 'none' && !reduceMotion;
  const withIntro = animate && kind === 'celebrate' && intro != null;
  const introMs = withIntro ? ACTY_INTRO_MS : 0;

  const lift = useSharedValue(0);
  const squashY = useSharedValue(1);
  const squashX = useSharedValue(1);
  const tilt = useSharedValue(0);
  const pop = useSharedValue(withIntro ? 0.6 : 1);
  const introShown = useSharedValue(withIntro ? 1 : 0);

  useEffect(() => {
    if (!animate) return;
    if (kind === 'think') {
      tilt.value = withSequence(
        withTiming(-1, { duration: 450, easing: easing.standard }),
        withRepeat(withTiming(1, { duration: 900, easing: easing.standard }), -1, true),
      );
      lift.value = withRepeat(withTiming(-2, { duration: 900, easing: easing.standard }), -1, true);
    } else {
      const hop = (height: number) => [
        withTiming(-height, { duration: HOP_UP, easing: easing.enter }),
        withTiming(0, { duration: HOP_DOWN, easing: easing.exit }),
      ];
      pop.value = withSpring(1, { damping: 10, stiffness: 260 });
      if (withIntro) introShown.value = withDelay(introMs, withTiming(0, { duration: SWAP_MS }));
      lift.value = withDelay(
        introMs,
        withSequence(
          ...hop(size.height * 0.16),
          withTiming(0, { duration: HOP_GAP }),
          ...hop(size.height * 0.08),
          withDelay(motion.slow, withRepeat(withTiming(-3, { duration: 1600, easing: easing.standard }), -1, true)),
        ),
      );
      // 착지할 때 아래로 눌렸다가 돌아온다 — 첫 착지가 더 세다.
      const firstLand = introMs + HOP_UP + HOP_DOWN;
      const secondGap = HOP_GAP + HOP_UP + HOP_DOWN - 70 - 130;
      squashY.value = withDelay(
        firstLand,
        withSequence(
          withTiming(0.88, { duration: 70 }),
          withTiming(1, { duration: 130 }),
          withDelay(secondGap, withSequence(withTiming(0.94, { duration: 60 }), withSpring(1, { damping: 8, stiffness: 300 }))),
        ),
      );
      squashX.value = withDelay(
        firstLand,
        withSequence(
          withTiming(1.08, { duration: 70 }),
          withTiming(1, { duration: 130 }),
          withDelay(secondGap, withSequence(withTiming(1.04, { duration: 60 }), withSpring(1, { damping: 8, stiffness: 300 }))),
        ),
      );
    }
    return () => {
      [lift, squashY, squashX, tilt, pop, introShown].forEach((v) => cancelAnimation(v));
    };
  }, [animate, kind, withIntro, introMs, size.height, lift, squashY, squashX, tilt, pop, introShown]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      // 눌림은 발밑 기준 — 가운데 기준으로 줄어든 만큼 아래로 내린다.
      { translateY: lift.value + ((1 - squashY.value) * size.height) / 2 },
      { rotate: `${tilt.value * 6}deg` },
      { scaleX: squashX.value * pop.value },
      { scaleY: squashY.value * pop.value },
    ],
  }));
  const introStyle = useAnimatedStyle(() => ({ opacity: introShown.value }));
  const finalStyle = useAnimatedStyle(() => ({ opacity: 1 - introShown.value }));

  return (
    <View testID={testID} style={size} accessible={false} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, bodyStyle]}>
        {withIntro && (
          <Animated.View style={[StyleSheet.absoluteFill, introStyle]}>
            <Image testID={testID && `${testID}-intro`} source={intro} style={size} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          </Animated.View>
        )}
        <Animated.View style={[StyleSheet.absoluteFill, finalStyle]}>
          <Image testID={testID && `${testID}-pose`} source={source} style={size} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
