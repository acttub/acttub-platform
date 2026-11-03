import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, shadowOverlay, space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「FloatingButton/Add」 — 목록 화면의 「추가」 전용. 높이 48 · r-full · 오른쪽 20, 더하기 20 + body1-bold.
 * `bottom`은 탭바 위 12(탭바가 없으면 안전 영역 + 12)를 부르는 쪽에서 준다. 목록 맨 아래에 이 버튼이 가리지 않을 여백을 둔다.
 */
export function FloatingAddButton({
  label,
  bottom,
  onPress,
  phLabel,
}: {
  label: string;
  bottom: number;
  onPress: () => void;
  phLabel?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, { bottom }, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      ph-label={phLabel}>
      <Feather name="plus" size={20} color={palette.onAccent} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: space.gutter,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    paddingHorizontal: space[5],
    borderRadius: radius.full,
    backgroundColor: palette.blue,
    ...shadowOverlay,
  },
  pressed: { opacity: 0.85 },
  label: { ...type.body1Bold, color: palette.onAccent },
});
