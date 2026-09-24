import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import type { TutorialMode } from '@/lib/tutorial';

export type TutorialChoice = TutorialMode | 'later';

/**
 * 처음 연 사람에게 "연습 한 바퀴"를 권하는 아래 시트 (SOMA-494).
 *
 * <p>영상이 있으면 내 영상으로, 없으면 예시로 — 둘 다 실제 루프 화면을 그대로 지난다.
 * 시트는 40px 아래에서 올라오고 배경이 함께 짙어진다. 닫힐 때는 더 짧게 — 나갈 때가
 * 들어올 때보다 가벼워야 한다(Toss motion).
 */
export function TutorialIntroSheet({
  visible,
  onChoose,
}: {
  visible: boolean;
  onChoose: (choice: TutorialChoice) => void;
}) {
  const insets = useSafeAreaInsets();
  // 닫는 애니메이션이 끝날 때까지 창을 붙들어 둔다 — 바로 내리면 뚝 끊긴다.
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  // 닫기 애니메이션의 끝 알림은 한 박자 늦게 온다. 그 사이에 다시 열렸으면 내리지 않는다 —
  // 첫 그림 때 돈 닫기(0→0)의 알림이 막 연 시트를 내려 버리던 것이 실기기에서 걸렸다.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const unmountIfHidden = () => {
    if (!visibleRef.current) setMounted(false);
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: motion.standard, easing: easing.enter });
    } else {
      progress.value = withTiming(
        0,
        { duration: motion.fast, easing: easing.exit },
        (finished) => {
          if (finished) runOnJS(unmountIfHidden)();
        },
      );
    }
  }, [visible, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 40 }],
  }));

  if (!mounted) return null;

  const choice = (label: string, sub: string, icon: 'video' | 'play-circle', value: TutorialMode, index: number) => (
    <Animated.View
      entering={FadeInDown.duration(motion.standard)
        .delay(120 + index * 70)
        .easing(easing.enter)}>
      <Pressable
        style={({ pressed }) => [styles.choice, index === 0 && styles.choicePrimary, pressed && styles.pressed]}
        onPress={() => onChoose(value)}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <View style={[styles.choiceIcon, index === 0 && styles.choiceIconPrimary]}>
          <Feather name={icon} size={20} color={index === 0 ? '#FFFFFF' : palette.blue} />
        </View>
        <View style={styles.choiceText}>
          <Text style={styles.choiceTitle}>{label}</Text>
          <Text style={styles.choiceSub}>{sub}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={palette.checkOff} />
      </Pressable>
    </Animated.View>
  );

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => onChoose('later')}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onChoose('later')} accessibilityLabel={t('tutorial.later')} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }, sheetStyle]}
        accessibilityViewIsModal
        accessibilityLabel={t('tutorial.a11y')}>
        <View style={styles.handle} />
        <Text style={styles.eyebrow}>{t('tutorial.introEyebrow')}</Text>
        <Text style={styles.title}>{t('tutorial.introTitle')}</Text>
        <Text style={styles.body}>{t('tutorial.introBody')}</Text>
        <View style={styles.choices}>
          {choice(t('tutorial.ownTitle'), t('tutorial.ownSub'), 'video', 'own', 0)}
          {choice(t('tutorial.sampleTitle'), t('tutorial.sampleSub'), 'play-circle', 'sample', 1)}
        </View>
        <Pressable onPress={() => onChoose('later')} hitSlop={12} accessibilityRole="button" style={styles.later}>
          <Text style={styles.laterText}>{t('tutorial.later')}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2, 9, 19, 0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 18,
  },
  eyebrow: { fontSize: 13, fontWeight: '800', color: palette.blue },
  title: { fontSize: 22, fontWeight: '800', color: palette.text, lineHeight: 30, marginTop: 6 },
  body: { fontSize: 14.5, color: palette.textDim, lineHeight: 22, marginTop: 8 },
  choices: { gap: 10, marginTop: 20 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    backgroundColor: palette.card,
  },
  choicePrimary: { borderColor: palette.blueLine, backgroundColor: palette.blueMist },
  pressed: { opacity: 0.85 },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.blueSoft,
  },
  choiceIconPrimary: { backgroundColor: palette.blue },
  choiceText: { flex: 1, gap: 3 },
  choiceTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  choiceSub: { fontSize: 13, color: palette.textMuted, lineHeight: 19 },
  later: { alignSelf: 'center', paddingVertical: 14, marginTop: 6 },
  laterText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
});
