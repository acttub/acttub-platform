import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 고르는 줄(pen 세션 목적·영상 고르기, SOMA-748) — 파란 아이콘 · 제목 17/700 · 보조 14/500.
 * `selected`면 옅은 파랑 바탕에 파란 제목, 오른쪽은 체크. 아니면 꺾쇠. `highlight`는 권하는 줄(고르지 않아도 파랗게)이다.
 */
export function ChoiceRow({
  icon,
  title,
  sub,
  selected = false,
  highlight = false,
  mark = 'chevron',
  disabled,
  onPress,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  selected?: boolean;
  highlight?: boolean;
  /** 오른쪽 표시 — 고르는 목록은 'check'(골랐을 때만), 다음 화면으로 가는 줄은 'chevron'. */
  mark?: 'check' | 'chevron';
  disabled?: boolean;
  onPress: () => void;
}) {
  const on = selected || highlight;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && !on && styles.pressed]}>
      <View style={styles.iconBox}>
        <Feather name={icon} size={22} color={palette.blue} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, on && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {mark === 'check' ? (
        selected ? <Feather name="check" size={20} color={palette.blue} /> : <Feather name="chevron-right" size={20} color={palette.textFaint} />
      ) : (
        <Feather name="chevron-right" size={20} color={palette.textFaint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  rowOn: { backgroundColor: palette.blueSoft },
  pressed: { backgroundColor: palette.bgSubtle },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 25, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textMuted },
});
