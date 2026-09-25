import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { translate as t } from '@/lib/i18n';
import type { RecordMode } from '@/lib/record-modes';

/** 라벨 한 칸 너비. 고른 칸이 늘 화면 가운데(셔터 아래)에 오게 줄 전체를 민다. */
const ITEM = 104;

/**
 * 셔터 아래 용도 줄 (SOMA-494, 인스타 만들기 화면처럼).
 *
 * <p>고른 용도가 가운데 오도록 줄이 미끄러진다. 라벨을 눌러도 되고, 화면을 옆으로 넘겨도 된다
 * (넘기기는 촬영 화면이 받는다 — 여기는 그리기와 누르기만 맡는다). 가운데 점이 지금 용도를 가리킨다.
 */
export function RecordModeSlider({
  modes,
  value,
  onChange,
  disabled,
}: {
  modes: RecordMode[];
  value: RecordMode;
  onChange: (mode: RecordMode) => void;
  disabled?: boolean;
}) {
  const { width } = useWindowDimensions();
  const index = Math.max(0, modes.indexOf(value));
  const shift = useSharedValue(width / 2 - (index * ITEM + ITEM / 2));

  useEffect(() => {
    shift.value = withTiming(width / 2 - (index * ITEM + ITEM / 2), {
      duration: motion.standard,
      easing: easing.standard,
    });
  }, [index, shift, width]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      <Animated.View style={[styles.row, rowStyle]}>
        {modes.map((mode) => {
          const on = mode === value;
          return (
            <Pressable
              key={mode}
              style={styles.item}
              disabled={disabled}
              onPress={() => onChange(mode)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
                {t(`recordMode.${mode}`)}
              </Text>
            </Pressable>
          );
        })}
      </Animated.View>
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 44, justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', position: 'absolute', left: 0, top: 4 },
  item: { width: ITEM, alignItems: 'center', paddingVertical: 6 },
  label: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 14, fontWeight: '700' },
  labelOn: { color: '#FFFFFF', fontWeight: '900' },
  dot: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
});
