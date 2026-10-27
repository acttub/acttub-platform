import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 챌린지 상태 띠 — 집계 중·순위 확정·검토 중은 `amber-soft` 주의, 숨김은 `danger-soft`. 아이콘 16 + body2-bold, r-md, 안쪽 [12,16].
 */
export function ChallengeNotice({ message, tone = 'amber' }: { message: string; tone?: 'amber' | 'danger' }) {
  const danger = tone === 'danger';
  const color = danger ? palette.danger : palette.amber;
  return (
    <View style={[styles.band, { backgroundColor: danger ? palette.dangerSoft : palette.amberSoft }]}>
      <Feather name="info" size={16} color={color} />
      <Text style={[styles.text, { color }]}>{message}</Text>
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
});
