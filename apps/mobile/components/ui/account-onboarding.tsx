import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

const MASCOT = require('@/assets/images/mascot-coach.png');

/** pen 온보딩 「진행 머리」(SOMA-748) — 꺾쇠 · 진행 막대(8, 둥근 4) · n/N. */
export function OnboardingStepHeader({ step, total, onBack }: { step: number; total: number; onBack: () => void }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, step / total)) : 0;
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Feather name="chevron-left" size={26} color={palette.text} />
      </Pressable>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: step }}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <Text style={styles.count}>
        {step}/{total}
      </Text>
    </View>
  );
}

/** pen 「캐릭터 말풍선」 — 마스코트 + 회색 말풍선(질문 20/800) + 파란 안내(14/700). */
export function OnboardingAsk({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.ask}>
      <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.bubble}>
        <Text style={styles.bubbleTitle}>{title}</Text>
        {hint ? <Text style={styles.bubbleHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 20 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.bgSoft, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: palette.blue },
  count: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  ask: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingBottom: 8 },
  mascot: { width: 70, height: 78 },
  bubble: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: palette.bgSoft,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
  },
  bubbleTitle: { fontSize: 20, fontWeight: '800', lineHeight: 28, color: palette.text },
  bubbleHint: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
});
