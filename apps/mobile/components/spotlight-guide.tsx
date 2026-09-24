import { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import {
  captionPlacement,
  holeOf,
  rectStyle,
  relativeTo,
  shroudRects,
  stepAfter,
  type SpotlightStep,
} from '@/lib/guide-spotlight';
import { translate as t } from '@/lib/i18n';
import { currentSpotlight, onSpotlightChanged, showSpotlight } from '@/lib/spotlight-host';
import { onTargetsChanged, remeasureTargets, targetRect } from '@/lib/spotlight-targets';

export type { SpotlightStep };

/** 설명 카드를 아직 못 쟀을 때 쓸 어림값. 첫 그림 한 번만 쓰이고 바로 실제 높이로 바뀐다. */
const CAPTION_GUESS = 190;

/**
 * 화면이 "이 가이드를 띄워 달라"고 맡긴다. 그리는 일은 {@link SpotlightHost} 가 한다 —
 * 앱 맨 바깥에서 같은 창에 그려야 비출 자리와 기준이 맞는다({@code lib/spotlight-host}).
 */
export function SpotlightGuide({
  visible,
  steps,
  topic,
  onDone,
}: {
  visible: boolean;
  steps: SpotlightStep[];
  topic: string;
  onDone: (how: 'skip' | 'done') => void;
}) {
  // onDone 은 대개 그 자리에서 만든 함수라 다시 그릴 때마다 새것이다 — 그걸 의존성에 넣으면
  // 띄웠다 내렸다를 반복한다. 최신 것만 들고 있다가 끝날 때 부른다.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!visible || steps.length === 0) return;
    showSpotlight({ steps, topic, onDone: (how) => done.current(how) });
    return () => showSpotlight(null);
  }, [visible, steps, topic]);
  return null;
}

/**
 * 누를 곳만 남기고 나머지를 어둡게 덮는다 (SOMA-550).
 *
 * <p>앱을 처음 연 사람에게 슬라이드로 설명하는 대신, 지금 화면에서 <b>누를 자리</b>를 바로
 * 비춘다. 비친 곳을 누르면 다음으로 넘어가고, 어두운 곳은 눌러도 아무 일이 없다 —
 * 잘못 눌러 가이드가 사라지는 게 제일 답답하다. 언제든 "건너뛰기"로 끝낼 수 있다.
 *
 * <p>덮는 방식은 {@code lib/guide-spotlight} 에 적어 뒀다(마스크 없이 사각형 넷).
 *
 * <p>움직임(SOMA-494): 다음 단계로 가면 구멍이 새 자리로 미끄러져 간다 — 뚝 끊겨 옮겨 가면
 * 어디가 바뀌었는지 눈이 못 따라간다. 덮개 넷과 테두리가 같은 값을 따라가고, 설명 카드는
 * 단계마다 아래에서 살짝 떠오른다. 처음 뜰 때는 구멍을 제자리에 바로 두고 전체가 페이드로
 * 들어온다. 기기에서 "동작 줄이기"를 켜 두면 reanimated 가 움직임 없이 끝 상태로 옮긴다.
 *
 * <p>루트 레이아웃이 화면들 위에 하나만 둔다. 화면 안이 아니라 여기 있어야 탭바의 촬영
 * 버튼까지 덮을 수 있고, 앱과 같은 창이라 좌표를 보정할 일이 없다.
 */
export function SpotlightHost() {
  const screen = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [captionHeight, setCaptionHeight] = useState(CAPTION_GUESS);
  // 띄워 달라는 요청도, 비출 자리도 화면 밖에서 바뀐다 — 바뀌면 다시 그린다.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  // 덮개 판의 원점은 창 기준과 다르다 — 판 자신을 같은 방법으로 재서 그 차이를 뺀다.
  const probe = useRef<View | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  // 구멍 자리·모양과 설명 카드 높이. 셋 다 같은 박자로 움직인다.
  const hx = useSharedValue(0);
  const hy = useSharedValue(0);
  const hw = useSharedValue(0);
  const hh = useSharedValue(0);
  const hr = useSharedValue(0);
  const shown = useSharedValue(0);
  const pulse = useSharedValue(0);
  // 방금 연 참이면 구멍을 미끄러뜨리지 않고 제자리에 둔다 — 화면 구석에서 날아오면 어지럽다.
  const placed = useRef(false);

  useEffect(() => onSpotlightChanged(refresh), []);
  useEffect(() => onTargetsChanged(refresh), []);

  const request = currentSpotlight();
  const open = request !== null;

  // 띄우는 순간 자리를 다시 잰다 — 첫 배치 때 잰 값은 제자리가 아닐 수 있다.
  // 한 박자 뒤 한 번 더 재서, 화면이 막 열리는 중이라 아직 안 잡힌 경우까지 받는다.
  useEffect(() => {
    if (!open) return;
    remeasureTargets();
    const again = setTimeout(remeasureTargets, 250);
    return () => clearTimeout(again);
  }, [open, index]);

  useEffect(() => {
    if (!open) {
      setIndex(0);
      placed.current = false;
      shown.value = 0;
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    shown.value = withTiming(1, { duration: motion.standard, easing: easing.enter });
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [open, pulse, shown]);

  const steps = request?.steps ?? [];
  const step = steps.length > 0 ? steps[Math.min(index, steps.length - 1)] : null;
  const hole = step ? holeOf(relativeTo(targetRect(step.target), origin), screen) : null;
  // 카드는 미끄러뜨리지 않는다 — 단계마다 새로 떠오르고(FadeInDown), 구멍 쪽 모서리에 붙는다.
  const placement = captionPlacement(hole, screen, captionHeight);
  const radius = hole ? (step?.round ? hole.height / 2 : 18) : 0;

  // 구멍이 갈 자리. 그림(렌더)이 아니라 효과에서 옮긴다 — 렌더 중에 공유값을 쓰면 안 된다.
  const holeKey = hole ? `${hole.x}|${hole.y}|${hole.width}|${hole.height}|${radius}` : 'none';
  useEffect(() => {
    if (!open) return;
    const go = (value: typeof hx, to: number) => {
      value.value = placed.current
        ? withTiming(to, { duration: motion.slow, easing: easing.standard })
        : to;
    };
    if (hole) {
      go(hx, hole.x);
      go(hy, hole.y);
      go(hw, hole.width);
      go(hh, hole.height);
      go(hr, radius);
      placed.current = true;
    }
    // holeKey 가 hole·radius 를 대신한다 — 매 렌더 새 객체라 그대로 넣으면 계속 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, holeKey]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  // 덮개 넷 — 위·아래는 화면 폭 전체, 왼쪽·오른쪽은 구멍 높이만큼(겹치면 그 자리만 진해진다).
  const topStyle = useAnimatedStyle(() => ({
    left: 0,
    top: 0,
    width: screen.width,
    height: Math.max(0, hy.value),
  }));
  const bottomStyle = useAnimatedStyle(() => ({
    left: 0,
    top: hy.value + hh.value,
    width: screen.width,
    height: Math.max(0, screen.height - hy.value - hh.value),
  }));
  const leftStyle = useAnimatedStyle(() => ({
    left: 0,
    top: hy.value,
    width: Math.max(0, hx.value),
    height: hh.value,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    left: hx.value + hw.value,
    top: hy.value,
    width: Math.max(0, screen.width - hx.value - hw.value),
    height: hh.value,
  }));
  const holeStyle = useAnimatedStyle(() => ({
    left: hx.value,
    top: hy.value,
    width: hw.value,
    height: hh.value,
    borderRadius: hr.value,
  }));
  const ringStyle = useAnimatedStyle(() => ({
    left: hx.value,
    top: hy.value,
    width: hw.value,
    height: hh.value,
    borderRadius: hr.value,
    opacity: 0.95 - pulse.value * 0.6,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  if (!request || !step) return null;

  const last = index === steps.length - 1;

  const finish = (how: 'skip' | 'done') => {
    logEvent('spotlight_finish', { topic: request.topic, how, at: index });
    request.onDone(how);
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
    // 어두운 곳을 눌러도 아래 화면이 눌리지 않게 여기서 손가락을 받는다.
    <Animated.View
      style={[styles.root, rootStyle]}
      ref={probe}
      onLayout={() =>
        probe.current?.measureInWindow((x, y) => {
          if (Number.isFinite(x) && Number.isFinite(y)) setOrigin({ x, y });
        })
      }
      onStartShouldSetResponder={() => true}>
      {hole ? (
        <>
          <Animated.View style={[styles.shroud, topStyle]} />
          <Animated.View style={[styles.shroud, bottomStyle]} />
          <Animated.View style={[styles.shroud, leftStyle]} />
          <Animated.View style={[styles.shroud, rightStyle]} />
          {/* 비친 자리를 누르면 다음으로. 어두운 곳은 눌러도 아무 일이 없다. */}
          <Animated.View style={[styles.hole, holeStyle]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={t(`${step.text}Title`)}
            />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.ring, ringStyle]} />
        </>
      ) : (
        // 아직 못 잰 자리 — 전체를 덮고 설명만 보여 준다.
        <View style={[styles.shroud, rectStyle(shroudRects(null, screen)[0])]} />
      )}

      <View
        style={[styles.caption, placement]}
        onLayout={(e) => setCaptionHeight(e.nativeEvent.layout.height)}>
        <Animated.View
          key={index}
          style={styles.captionInner}
          entering={FadeInDown.duration(motion.standard).easing(easing.enter)}>
          <View style={styles.progress}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <StepDot key={i} active={i === index} done={i < index} />
              ))}
            </View>
            <Text style={styles.step}>
              {t('guide.stepOf', { at: index + 1, total: steps.length })}
            </Text>
          </View>
          <Text style={styles.title}>{t(`${step.text}Title`)}</Text>
          <Text style={styles.body}>{t(`${step.text}Body`)}</Text>
        </Animated.View>
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
    </Animated.View>
  );
}

/** 진행 점 — 지금 단계는 길게 늘어나고, 지난 단계는 파랑으로 남는다. */
function StepDot({ active, done }: { active: boolean; done: boolean }) {
  const width = useSharedValue(active ? 18 : 6);
  useEffect(() => {
    width.value = withTiming(active ? 18 : 6, { duration: motion.standard, easing: easing.standard });
  }, [active, width]);
  const style = useAnimatedStyle(() => ({ width: width.value }));
  return <Animated.View style={[styles.dot, (active || done) && styles.dotOn, style]} />;
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  shroud: { position: 'absolute', backgroundColor: 'rgba(11, 18, 38, 0.82)' },
  hole: { position: 'absolute' },
  // 밝은 배경 위에서도 보이게 파랑으로 두른다 — 흰 테두리는 흰 화면에 묻힌다.
  ring: { position: 'absolute', borderWidth: 3, borderColor: palette.blue },
  caption: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: palette.card,
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  captionInner: { gap: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3, backgroundColor: palette.border },
  dotOn: { backgroundColor: palette.blue },
  step: { fontSize: 12, fontWeight: '800', color: palette.blue, letterSpacing: 0.4 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text, lineHeight: 26 },
  body: { fontSize: 14, color: palette.textDim, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  skip: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  cta: { backgroundColor: palette.blue, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  pressed: { opacity: 0.9 },
  ctaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
