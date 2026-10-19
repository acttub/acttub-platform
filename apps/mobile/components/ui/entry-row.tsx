import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * pen 「줄」(코칭 입구·리딩 입구, SOMA-748) — 파란 아이콘 · 제목 17/700 · 보조 14/500 · 꺾쇠.
 * 카드 테두리 없이 줄만 놓는다. `eyebrow`가 있으면 제목 위에 파란 안내 한 줄을 단다.
 */
export function EntryRow({
  icon,
  title,
  sub,
  eyebrow,
  onPress,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  eyebrow?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.iconBox}>
        <Feather name={icon} size={22} color={palette.blue} />
      </View>
      <View style={styles.body}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={20} color={palette.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 4,
    borderRadius: 16,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 6 },
  eyebrow: { fontSize: 13, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 25, color: palette.text },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textMuted },
});
