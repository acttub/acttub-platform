import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「SelectCard/Off·On」 — 둘 중 하나를 고르는 카드. 흰 바탕 · 1px border · r-lg · 안쪽 [16,20],
 * 제목 body1-bold · 설명 caption `text-meta`. 고르면 blue-soft 바탕 · 1.5px blue · 제목 blue-deep · 오른쪽 체크 22.
 */
export function SelectCard({
  title,
  sub,
  selected,
  onPress,
  disabled,
  phLabel,
}: {
  title: string;
  sub?: string | null;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  phLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.card, selected && styles.on, pressed && styles.pressed, disabled && styles.dim]}>
      <View style={styles.body}>
        <Text style={[styles.title, selected && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {selected ? <Feather name="check-circle" size={22} color={palette.blue} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  on: {
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.blueSoft,
    paddingVertical: space[4] - 0.5,
    paddingHorizontal: space[5] - 0.5,
  },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
  body: { flex: 1, gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { ...type.caption, color: palette.textMeta },
});
