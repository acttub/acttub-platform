import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { BandGradient } from '@/components/ui/band-gradient';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

// 설정 Pro 카드 왕관 타일과 같은 파랑→보라(settings-pro-card TILE_STOPS) — 홈에서도 같은 Pro 로 읽히게 한다.
const PRO_STOPS = [
  [0, '#6F9CFA'],
  [1, '#7C6BEF'],
] as const;

/**
 * 홈 맨 위 알림 종 옆 플랜 표시(SOMA-981). Pro 면 그라데이션 「PRO」, 무료면 회색 테두리 「FREE」.
 * 누르면 설정 Pro 카드와 같은 곳(구독 관리·Pro 안내)으로 간다. 무엇을 그릴지는 lib/billing homePlan 이 정한다.
 */
export function HomePlanBadge({ plan, onPress, style }: { plan: 'pro' | 'free'; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const pro = plan === 'pro';
  return (
    <Pressable
      testID="home-plan-badge"
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={pro ? t('home.planProA11y') : t('home.planFreeA11y')}
      ph-label={pro ? 'home_plan_pro' : 'home_plan_free'}
      style={({ pressed }) => [styles.badge, pro ? styles.pro : styles.free, pressed && styles.pressed, style]}>
      {pro && <BandGradient stops={PRO_STOPS} horizontal bands={16} />}
      {pro && <MaterialCommunityIcons name="crown-outline" size={14} color={palette.onAccent} />}
      <Text style={[styles.label, pro ? styles.proLabel : styles.freeLabel]}>{pro ? t('home.planPro') : t('home.planFree')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  pro: {},
  free: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  pressed: { opacity: 0.85 },
  label: { ...type.micro, letterSpacing: 0.6 },
  proLabel: { color: palette.onAccent },
  freeLabel: { color: palette.textSub },
});
