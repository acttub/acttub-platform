import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 주의 띠 — `amber-soft` 주의(집계 중·검토 중·푸시 꺼짐·안내 문구), 숨김 같은 문제는 `danger-soft`. r-md, 안쪽 [12,16].
 * 기본은 아이콘 16 + body2-bold(챌린지 상태). `compact`는 화면 위 덧붙임 안내라 아이콘 14 + caption-bold 다.
 */
export function NoticeBand({
  message,
  tone = 'amber',
  icon = 'info',
  compact = false,
  style,
}: {
  message: string;
  tone?: 'amber' | 'danger';
  icon?: ComponentProps<typeof Feather>['name'];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const danger = tone === 'danger';
  const color = danger ? palette.danger : palette.amber;
  return (
    <View style={[styles.band, { backgroundColor: danger ? palette.dangerSoft : palette.amberSoft }, style]}>
      {/* Pretendard 서브셋에 원문자(U+2460~24FF)가 없어 'ⓘ'는 두부로 나온다 — 아이콘 폰트로 그린다. */}
      <Feather name={icon} size={compact ? 14 : 16} color={color} />
      <Text style={[compact ? styles.compactText : styles.text, { color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
  },
  text: { ...type.body2Bold, flex: 1 },
  compactText: { ...type.captionBold, flex: 1 },
});
