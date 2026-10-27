import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, shadowOverlay, space, type } from '@/constants/tokens';

/**
 * 잠깐 뜨는 안내 — 디자인 시스템 pen 「Toast」. 높이 48, `toast` 바탕, r-md, 안쪽 좌우 20, 아이콘 18 + body2-bold `on-accent`.
 * 화면 아래 한 곳에 뜨고 누를 수 없다. `bottom`은 아래 고정 바·행동 줄 위로 띄울 거리(그 위 12)다.
 */
export function Toast({
  message,
  icon = 'check-circle',
  bottom,
}: {
  message: string;
  icon?: 'check-circle' | 'info';
  bottom: number;
}) {
  return (
    <View style={[styles.toast, { bottom }]} pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Feather name={icon} size={18} color={palette.onAccent} />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: palette.toast,
    ...shadowOverlay,
  },
  text: { ...type.body2Bold, flex: 1, color: palette.onAccent },
});
