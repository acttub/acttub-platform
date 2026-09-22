import { useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import {
  captionTop,
  holeOf,
  rectStyle,
  shroudRects,
  relativeTo,
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
 * <p>루트 레이아웃이 화면들 위에 하나만 둔다. 화면 안이 아니라 여기 있어야 탭바의 촬영
 * 버튼까지 덮을 수 있고, 앱과 같은 창이라 좌표를 보정할 일이 없다.
 */
export function SpotlightHost() {
  const screen = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [captionHeight, setCaptionHeight] = useState(CAPTION_GUESS);
  // 띄워 달라는 요청도, 비출 자리도 화면 밖에서 바뀐다 — 바뀌면 다시 그린다.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const pulse = useRef(new Animated.Value(0)).current;
  // 덮개 판의 원점은 창 기준과 다르다 — 판 자신을 같은 방법으로 재서 그 차이를 뺀다.
  const probe = useRef<View | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

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
  }, [open, pulse]);

  if (!request) return null;

  const steps = request.steps;
  const step = steps[Math.min(index, steps.length - 1)];
  const hole = holeOf(relativeTo(targetRect(step.target), origin), screen);
  const shroud = shroudRects(hole, screen);
  const top = captionTop(hole, screen, captionHeight);
  const last = index === steps.length - 1;
  const radius = hole ? (step.round ? hole.height / 2 : 18) : 0;

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
    <View
      style={styles.root}
      ref={probe}
      onLayout={() =>
        probe.current?.measureInWindow((x, y) => {
          if (Number.isFinite(x) && Number.isFinite(y)) setOrigin({ x, y });
        })
      }
      onStartShouldSetResponder={() => true}>
      {shroud.map((r, i) => (
        <View key={`shroud-${i}`} style={[styles.shroud, rectStyle(r)]} />
      ))}

      {hole && (
        <>
          {/* 비친 자리를 누르면 다음으로. 어두운 곳은 눌러도 아무 일이 없다. */}
          <Pressable
            style={[styles.hole, rectStyle(hole), { borderRadius: radius }]}
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={t(`${step.text}Title`)}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              rectStyle(hole),
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
  );
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
  step: { fontSize: 12, fontWeight: '800', color: palette.blue, letterSpacing: 0.4 },
  title: { fontSize: 19, fontWeight: '800', color: palette.text, lineHeight: 26 },
  body: { fontSize: 14, color: palette.textDim, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  skip: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  cta: { backgroundColor: palette.blue, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  pressed: { opacity: 0.9 },
  ctaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
