import { StyleSheet, Text, View } from 'react-native';

import { NavBackButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

/**
 * 단계 머리 — 디자인 시스템 pen 「StepHeader」. NavHeader 와 같은 44 줄에 꺾쇠 · 「n / N」(caption), 아래 4px 진행 막대.
 * 뒤로만 있는 머리는 제목 없는 NavHeader 를 쓴다.
 */
export function StepHeader({ step, total, onBack }: { step: number; total: number; onBack: () => void }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, step / total)) : 0;
  return (
    <View>
      <View style={styles.row}>
        <NavBackButton onPress={onBack} phLabel="step_back" />
        <Text style={styles.count}>
          {step} / {total}
        </Text>
      </View>
      <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 44, flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[1] },
  count: { ...type.caption, color: palette.textMeta },
  track: { height: 4, backgroundColor: palette.bgSoft },
  fill: { height: 4, backgroundColor: palette.blue },
});
