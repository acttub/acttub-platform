import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import CoachingPane from '@/components/practice/coaching-pane';
import { PracticeModeTabs } from '@/components/practice/practice-mode-tabs';
import ReadingPane from '@/components/practice/reading-pane';
import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { isPracticeMode, knownPracticeMode, rememberPracticeMode, resolvePracticeMode, type PracticeMode } from '@/lib/practice-mode';

/** 쪽을 바꿀 때 내용이 이 투명도에서 짧게 또렷해진다. 「동작 줄이기」면 reanimated 가 바로 끝 상태로 둔다(constants/motion). */
const SWITCH_FROM_OPACITY = 0.4;

/**
 * 연습 탭 — 맨 위 「리딩 | 코칭」으로 예전 리딩 탭·코칭 탭 화면을 고른다(components/practice/*-pane).
 *
 * - 주소의 mode(`/practice?mode=coaching`, lib/practice-mode practiceHref)가 있으면 그쪽을 연다. 다른 화면·알림이 이 길로 보낸다.
 * - 없으면 기기에 남긴 마지막 쪽, 처음이면 리딩이다. 고른 쪽은 주소에도 적어 다음에 같은 주소로 와도 바뀌게 한다.
 * - 고르면 practice_mode_select { mode } 을 남긴다. 고르지 않은 쪽은 그리지 않는다 — 안내·불러오기가 보이는 쪽에서만 돈다.
 */
export default function PracticeTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const asked = isPracticeMode(params.mode) ? params.mode : null;
  const [mode, setMode] = useState<PracticeMode | null>(() => asked ?? knownPracticeMode());

  // 주소가 쪽을 정하면 그쪽으로 바꾸고 기억한다. 주소에 없으면 기기에서 읽는다.
  useEffect(() => {
    if (asked) {
      setMode(asked);
      void rememberPracticeMode(asked);
      return;
    }
    let live = true;
    void resolvePracticeMode().then((saved) => {
      if (live) setMode((now) => now ?? saved);
    });
    return () => {
      live = false;
    };
  }, [asked]);

  const opacity = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const choose = (next: PracticeMode) => {
    logEvent('practice_mode_select', { mode: next });
    setMode(next);
    void rememberPracticeMode(next);
    router.setParams({ mode: next });
    opacity.value = SWITCH_FROM_OPACITY;
    opacity.value = withTiming(1, { duration: motion.fast, easing: easing.enter });
  };

  if (!mode) return <View style={styles.blank} />;
  const modeSwitch = <PracticeModeTabs value={mode} onChange={choose} />;
  return (
    <Animated.View style={[styles.flex, fadeStyle]} testID={`practice-${mode}`}>
      {mode === 'reading' ? <ReadingPane modeSwitch={modeSwitch} /> : <CoachingPane modeSwitch={modeSwitch} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blank: { flex: 1, backgroundColor: palette.bg },
});
