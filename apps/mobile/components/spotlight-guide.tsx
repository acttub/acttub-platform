import { useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { captionTop, holeOf, shroudRects, stepAfter } from '@/lib/guide-spotlight';
import { translate as t } from '@/lib/i18n';
import { onTargetsChanged, remeasureTargets, targetRect } from '@/lib/spotlight-targets';

export type SpotlightStep = {
  /** 비출 요소의 이름표 ({@code lib/spotlight-targets} 의 TARGET). */
  target: string;
  /** 문구 키. `<키>Title` 과 `<키>Body` 를 읽는다. */
  text: string;
  /** 동그란 버튼이면 true — 테두리를 원으로 두른다. */
  round?: boolean;
};

/** 설명 카드를 아직 못 쟀을 때 쓸 어림값. 첫 그림 한 번만 쓰이고 바로 실제 높이로 바뀐다. */
const CAPTION_GUESS = 190;

/**
 * 누를 곳만 남기고 나머지를 어둡게 덮는 가이드 (SOMA-550).
 *
 * <p>앱을 처음 연 사람에게 슬라이드로 설명하는 대신, 지금 화면에서 <b>누를 자리</b>를 바로
 * 비춘다. 비친 곳을 누르면 다음으로 넘어가고, 어두운 곳은 눌러도 아무 일이 없다 —
 * 잘못 눌러 가이드가 사라지는 게 제일 답답하다. 언제든 "건너뛰기"로 끝낼 수 있다.
 *
 * <p>덮는 방식은 {@code lib/guide-spotlight} 에 적어 뒀다(마스크 없이 사각형 넷).
 */
export function SpotlightGuide({
  visible,
  steps,
  topic,
  onDone,
}: {
  visible: boolean;
  steps: SpotlightStep[];
  /** 분석에 남길 화면 이름. */
  topic: string;
  onDone: (how: 'skip' | 'done') => void;
}) {
  const screen = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [captionHeight, setCaptionHeight] = useState(CAPTION_GUESS);
  // 비출 자리는 그리는 쪽이 다 그린 뒤에 적는다 — 적히면 다시 그린다.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => onTargetsChanged(refresh), []);

  // 띄우는 순간 자리를 다시 잰다 — 첫 배치 때 잰 값은 제자리가 아닐 수 있다.
  // 한 박자 뒤 한 번 더 재서, 화면이 막 열리는 중이라 아직 안 잡힌 경우까지 받는다.
  useEffect(() => {
    if (!visible) return;
    remeasureTargets();
    const again = setTimeout(remeasureTargets, 250);
    return () => clearTimeout(again);
  }, [visible, index]);

  useEffect(() => {
    if (!visible) {
      setIndex(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible || steps.length === 0) return null;

  const step = steps[Math.min(index, steps.length - 1)];
  const hole = holeOf(targetRect(step.target), screen);
  const shroud = shroudRects(hole, screen);
  const top = captionTop(hole, screen, captionHeight);
  const last = index === steps.length - 1;
  const radius = hole ? (step.round ? hole.height / 2 : 18) : 0;

  const finish = (how: 'skip' | 'done') => {
    logEvent('spotlight_finish', { topic, how, at: index });
    onDone(how);
  };

  const next = () => {
    const after = stepAfter(index, steps.length);
    if (after === null) {
      finish('done');
      return;
    }
    setIndex(after);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => finish('skip')}>
      <View style={styles.root}>
        {shroud.map((r, i) => (
          <View key={`shroud-${i}`} style={[styles.shroud, r]} />
        ))}

        {hole && (
          <>
            {/* 비친 자리를 누르면 다음으로. 어두운 곳은 눌러도 아무 일이 없다. */}
            <Pressable
              style={[styles.hole, hole, { borderRadius: radius }]}
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={t(`${step.text}Title`)}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ring,
                hole,
                {
                  borderRadius: radius,
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.35] }),
                  transform: [
                    { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
                  ],
                },
              ]}
            />
          </>
        )}

        <View
          style={[styles.caption, { top }]}
          onLayout={(e) => setCaptionHeight(e.nativeEvent.layout.height)}>
          <Text style={styles.step}>{t('guide.stepOf', { at: index + 1, total: steps.length })}</Text>
          <Text style={styles.title}>{t(`${step.text}Title`)}</Text>
          <Text style={styles.body}>{t(`${step.text}Body`)}</Text>
          <View style={styles.row}>
            <Pressable onPress={() => finish('skip')} hitSlop={12} accessibilityRole="button">
              <Text style={styles.skip}>{t('guide.skip')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
              onPress={next}
              accessibilityRole="button">
              <Text style={styles.ctaText}>{t(last ? 'guide.gotIt' : 'guide.next')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shroud: { position: 'absolute', backgroundColor: 'rgba(11, 18, 38, 0.82)' },
  hole: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 2, borderColor: '#FFFFFF' },
  caption: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: palette.card,
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  step: { fontSize: 12, fontWeight: '800', color: palette.blue, letterSpacing: 0.4 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text, lineHeight: 26 },
  body: { fontSize: 14, color: palette.textDim, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  skip: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  cta: { backgroundColor: palette.blue, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  pressed: { opacity: 0.9 },
  ctaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
