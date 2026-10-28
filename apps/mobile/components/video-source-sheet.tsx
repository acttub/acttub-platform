import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AnchoredMenu, type MenuAnchor } from '@/components/ui/anchored-menu';
import { palette } from '@/constants/palette';

export type VideoSourceOption = {
  key: string;
  icon: 'archive' | 'video' | 'image';
  title: string;
  sub: string;
  onPress: () => void;
};

const ICON_TONE: Record<VideoSourceOption['icon'], { bg: string; fg: string }> = {
  archive: { bg: palette.blueSoft, fg: palette.blue },
  video: { bg: '#FFF1DE', fg: palette.hintIcon },
  image: { bg: palette.bgSoft, fg: palette.textMuted },
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
          <View style={[styles.icon, { backgroundColor: ICON_TONE[option.icon].bg }]}>
            <Feather name={option.icon} size={18} color={ICON_TONE[option.icon].fg} />
          </View>
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
  title: { fontSize: 13, fontWeight: '700', color: palette.textMuted, paddingHorizontal: 16, paddingTop: 12 },
  sub: { fontSize: 12, color: palette.textFaint, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  pressed: { backgroundColor: palette.bgSoft },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: palette.text },
  rowSub: { fontSize: 12, color: palette.textMuted },
});
