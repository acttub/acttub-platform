import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
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

import { easing } from '@/constants/motion';

/** 원래 한 장(hero-acty-book.png)을 같은 캔버스(670×620)에서 액티와 책 두 겹으로 나눈 것 — 겹치면 원본과 같다. */
const ACTY = require('@/assets/images/home/hero-acty.png');
const BOOK = require('@/assets/images/home/hero-book.png');

/** 그림 안에서 액티 발이 책에 닿는 높이(위에서 72%) — 숨 쉬기·착지 눌림의 기준점. */
const FEET = 0.72;
const HOP = 7;
const ENTRY_DELAY = 350;

/**
 * 홈 히어로의 책 읽는 액티(pen 「홈」). 책은 그대로 두고 액티만 움직인다.
 * - 홈이 뜨면 한 번 폴짝 뛰었다가 책 위에 앉고, 그 뒤로는 숨 쉬듯 몸이 아주 조금 늘었다 줄었다 한다.
 * - 액티를 누르면 다시 폴짝 뛴다.
 * 「동작 줄이기」를 켜면 원래 그림처럼 멈춰 있다. 자리·크기는 받은 style 그대로라 화면 배치가 바뀌지 않는다.
 */
export function HomeHeroActy({ style, height }: { style: StyleProp<ViewStyle>; height: number }) {
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(0);
  const squash = useSharedValue(1);
  const breath = useSharedValue(0);

  const hop = (delay = 0) => {
    lift.value = withDelay(
      delay,
      withSequence(withTiming(-HOP, { duration: 170, easing: easing.enter }), withTiming(0, { duration: 170, easing: easing.exit })),
    );
    squash.value = withDelay(
      delay + 340,
      withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, { damping: 8, stiffness: 300 })),
    );
  };

  useEffect(() => {
    if (reduceMotion) return;
    hop(ENTRY_DELAY);
    breath.value = withDelay(ENTRY_DELAY + 700, withRepeat(withTiming(1, { duration: 1400, easing: easing.standard }), -1, true));
    return () => {
      [lift, squash, breath].forEach((v) => cancelAnimation(v));
    };
    // 홈이 뜰 때 한 번만 — hop 은 shared value 만 바꾼다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const actyStyle = useAnimatedStyle(() => {
    const sy = squash.value * (1 + breath.value * 0.025);
    const sx = (2 - squash.value) * (1 - breath.value * 0.01);
    // 발밑(FEET) 기준으로 늘고 줄게 — 가운데 기준 변형을 그만큼 되돌린다.
    const pivot = (FEET - 0.5) * height;
    return { transform: [{ translateY: lift.value + pivot * (1 - sy) }, { scaleX: sx }, { scaleY: sy }] };
  });

  return (
    <Pressable
      testID="home-hero-acty"
      style={style}
      onPress={() => {
        if (!reduceMotion) hop();
      }}
      accessible={false}
    >
      <Image source={BOOK} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      <Animated.View style={[StyleSheet.absoluteFill, actyStyle]} pointerEvents="none">
        <Image source={ACTY} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      </Animated.View>
    </Pressable>
  );
}
