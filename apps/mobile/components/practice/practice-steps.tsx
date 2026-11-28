import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

export type PracticeStepKey = 'read' | 'shoot' | 'coach';

const STEPS: { key: PracticeStepKey; no: string; title: string; sub: string; art: ImageSourcePropType }[] = [
  { key: 'read', no: '①', title: 'practiceTab.stepRead', sub: 'practiceTab.stepReadSub', art: MASCOT.reading },
  { key: 'shoot', no: '②', title: 'practiceTab.stepShoot', sub: 'practiceTab.stepShootSub', art: MASCOT.slate },
  { key: 'coach', no: '③', title: 'practiceTab.stepCoach', sub: 'practiceTab.stepCoachSub', art: MASCOT.coach },
];

/**
 * 연습 탭 맨 위 단계 칸 셋(시안 B3) — ① 대사 익히기 → ② 촬영하기 → ③ 코칭 받기. 칸마다 액티 그림·번호·이름·작은 설명,
 * 칸 사이 작은 꺾쇠. 회색 바탕 칸(bg-subtle)이고 테두리는 두지 않는다.
 */
export function PracticeSteps({ onPress }: { onPress: (step: PracticeStepKey) => void }) {
  return (
    <View style={styles.row}>
      {STEPS.map((step, i) => (
        <Fragment key={step.key}>
          {i > 0 && <Feather name="chevron-right" size={14} color={palette.iconFaint} />}
          <Pressable
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
            onPress={() => onPress(step.key)}
            accessibilityRole="button"
            accessibilityLabel={t('practiceTab.stepA11y', { no: i + 1, title: t(step.title), sub: t(step.sub) })}
            ph-label={`practice_step_${step.key}`}>
            <Image source={step.art} style={MASCOT_SIZE.xs} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.title} numberOfLines={1}>{`${step.no} ${t(step.title)}`}</Text>
            <Text style={styles.sub} numberOfLines={1}>{t(step.sub)}</Text>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: space[1], paddingVertical: space[3], paddingHorizontal: space[1], borderRadius: radius.lg, backgroundColor: palette.bgSubtle },
  pressed: { opacity: 0.85 },
  title: { ...type.captionBold, color: palette.text },
  sub: { ...type.micro, color: palette.textMeta },
});
