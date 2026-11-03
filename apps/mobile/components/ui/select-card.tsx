import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Checkbox } from '@/components/ui/checkbox';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

/**
 * 디자인 시스템 pen 「SelectCard/Off·On」 — 둘 중 하나를 고르는 카드. 흰 바탕 · 1px border · r-lg · 안쪽 20,
 * 제목 body1-bold · 설명 body2 `text-sub`. 고르면 blue-soft 바탕 · 1.5px blue · 제목 blue-deep · 오른쪽 체크 22.
 */
export function SelectCard({
  title,
  sub,
  selected,
  onPress,
  disabled,
  phLabel,
  role = 'radio',
}: {
  title: string;
  sub?: string | null;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  phLabel?: string;
  /** 여럿을 고르는 카드면 checkbox. */
  role?: 'radio' | 'checkbox';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={title}
      accessibilityState={role === 'checkbox' ? { checked: selected, disabled: !!disabled } : { selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.card, selected && styles.on, pressed && styles.pressed, disabled && styles.dim]}>
      <View style={styles.body}>
        <Text style={[styles.title, selected && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {selected ? <Checkbox checked /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  on: {
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.blueSoft,
    padding: space[5] - 0.5,
  },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
  body: { flex: 1, gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { ...type.body2, color: palette.textSub },
});
