import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AnchoredMenu, type MenuAnchor } from '@/components/ui/anchored-menu';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';

export type VideoSourceOption = {
  key: string;
  icon: 'archive' | 'video' | 'image';
  title: string;
  sub: string;
  onPress: () => void;
};

/**
 * 새 연습 준비에서 영상 상자를 누르면 뜨는 작은 드롭다운 메뉴(SOMA-656). 보관함·촬영·갤러리 중 어디서 영상을 가져올지 고른다.
 * 줄을 누르면 메뉴를 닫고 그 갈래를 연다 — 여는 쪽(화면)이 메뉴가 닫힌 뒤에 다음 창을 띄운다.
 */
export function VideoSourceSheet({
  visible,
  title,
  sub,
  options,
  onClose,
  anchor,
}: {
  visible: boolean;
  title: string;
  sub: string;
  options: VideoSourceOption[];
  onClose: () => void;
  /** 누른 영상 상자 근처 점(화면 좌표). 없으면 오른쪽 위. */
  anchor?: MenuAnchor;
}) {
  if (!visible) return null;
  return (
    <AnchoredMenu anchor={anchor} width={300} estimatedHeight={options.length * 56 + 64} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
      {options.map((option) => (
        <Pressable
          key={option.key}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={option.onPress}
          accessibilityRole="button"
          accessibilityLabel={option.title}>
          <Feather name={option.icon} size={18} color={palette.textSub} />
          <View style={styles.text}>
            <Text style={styles.rowTitle}>{option.title}</Text>
            <Text style={styles.rowSub}>{option.sub}</Text>
          </View>
        </Pressable>
      ))}
    </AnchoredMenu>
  );
}

const styles = StyleSheet.create({
  title: { ...type.body2Bold, color: palette.text, paddingHorizontal: space[4], paddingTop: space[3] },
  sub: { ...type.caption, color: palette.textMeta, paddingHorizontal: space[4], paddingBottom: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[4], paddingVertical: space[2] },
  pressed: { backgroundColor: palette.bgSoft },
  text: { flex: 1 },
  rowTitle: { ...type.body2, color: palette.text },
  rowSub: { ...type.caption, color: palette.textMeta },
});
