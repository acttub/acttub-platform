import { StyleSheet, Text, View } from 'react-native';

import { BareBackButton, NavBackButton, NavIconButton } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 단계 머리 공통 부품(SOMA-770).
 *
 * - ProgressHeader — pen 「헤더 / 온보딩 진행」: 높이 44, 안쪽 [0,18,0,12], 꺾쇠 24 · 진행 막대(앞 21 · 뒤 11, 높이 7, 둥근 4,
 *   #F2F4F6 위 #4880EE) · n/N 15/700 #8B95A1.
 * - StepHeader — pen 「C/StepHeader」: 닫기(✕ 26) · 가운데 점(지금 18×7 파랑, 나머지 7×7 #E5E8EB, 간격 6) · 「1 / 3」 12.5/700 회색.
 */
export function ProgressHeader({ step, total, onBack }: { step: number; total: number; onBack: () => void }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, step / total)) : 0;
  return (
    <View style={styles.progress}>
      <BareBackButton onPress={onBack} phLabel="step_back" />
      <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <Text style={styles.count}>
        {step}/{total}
      </Text>
    </View>
  );
}

export function StepHeader({
  step,
  total,
  onClose,
  icon = 'x',
}: {
  step: number;
  total: number;
  onClose: () => void;
  /** 왼쪽 아이콘 — 기본은 닫기(✕), 앞 단계로 가는 머리는 꺾쇠. */
  icon?: 'x' | 'chevron-left';
}) {
  return (
    <View style={styles.dotsRow}>
      <View style={styles.dotsSide}>
        <NavIconButton
          icon={icon}
          size={26}
          label={icon === 'x' ? t('common.close') : t('common.back')}
          phLabel={icon === 'x' ? 'step_close' : 'step_back'}
          onPress={onClose}
        />
      </View>
      <View style={styles.dots} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: total, now: step }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.dot, i + 1 === step && styles.dotOn]} />
        ))}
      </View>
      <View style={[styles.dotsSide, styles.dotsRight]}>
        <Text style={styles.stepText}>
          {step} / {total}
        </Text>
      </View>
    </View>
  );
}

/** 단계 머리 없이 왼쪽 위 꺾쇠만 있는 머리(pen 「머리」 — 높이 52, 안쪽 [10,14]). */
export function BackOnlyHeader({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.backOnly}>
      <NavBackButton onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 18 },
  track: {
    flex: 1,
    height: 7,
    marginLeft: 21,
    marginRight: 11,
    borderRadius: 4,
    backgroundColor: palette.bgSoft,
    overflow: 'hidden',
  },
  fill: { height: 7, borderRadius: 4, backgroundColor: palette.blue },
  count: { fontSize: 15, fontWeight: '700', color: palette.textMeta },

  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6, paddingHorizontal: 6, backgroundColor: palette.bg },
  dotsSide: { width: 56, flexDirection: 'row', alignItems: 'center' },
  dotsRight: { justifyContent: 'flex-end', paddingRight: 10 },
  dots: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { width: 18, backgroundColor: palette.blue },
  stepText: { fontSize: 12.5, fontWeight: '700', color: palette.textMeta },

  backOnly: { height: 52, justifyContent: 'center', paddingHorizontal: 3 },
});
