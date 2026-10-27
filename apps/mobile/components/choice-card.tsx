import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** 아이콘 칸 색(디자인 시스템 SelectCard 의 아이콘 타일). tile 이 없으면 칸 바탕 없이 아이콘만 그린다. */
export const CHOICE_TINT = {
  blue: { tile: palette.blueSoft, icon: palette.blueDeep },
  amber: { tile: palette.amberSoft, icon: palette.amber },
  green: { tile: palette.greenSoft, icon: palette.green },
  plain: { tile: null, icon: palette.blue },
} as const;

export type ChoiceTint = keyof typeof CHOICE_TINT;

/**
 * 고르는 카드(디자인 시스템 SelectCard). 꺼짐은 흰 바탕 + 1px border, 고르면 blue-soft 바탕 + 1.5px blue 테두리 +
 * blue-deep 제목 + 오른쪽 원형 체크. 누르면 고른 표시만 되고, 아래 버튼을 눌러야 넘어간다.
 *
 * 고르기 전 오른쪽 표시는 mark 대로 빈 동그라미(radio)나 꺾쇠(chevron), 없으면 비운다.
 */
export function ChoiceCard({
  title,
  sub,
  selected,
  disabled,
  phLabel,
  icon,
  tint = 'blue',
  mark = 'none',
  onPress,
}: {
  title: string;
  sub?: string;
  selected: boolean;
  disabled?: boolean;
  phLabel?: string;
  icon?: FeatherName;
  tint?: ChoiceTint;
  mark?: 'none' | 'radio' | 'chevron';
  onPress: () => void;
}) {
  const colors = CHOICE_TINT[tint];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.card, selected && styles.cardOn, pressed && !selected && styles.pressed]}>
      {icon ? (
        <View style={[styles.tile, colors.tile ? { backgroundColor: colors.tile } : null]}>
          <Feather name={icon} size={20} color={colors.icon} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.title, selected && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {selected ? (
        <Feather name="check-circle" size={22} color={palette.blue} />
      ) : mark === 'radio' ? (
        <Feather name="circle" size={22} color={palette.textDisabled} />
      ) : mark === 'chevron' ? (
        <Feather name="chevron-right" size={20} color={palette.iconFaint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  cardOn: { borderWidth: 1.5, borderColor: palette.blue, backgroundColor: palette.blueSoft },
  pressed: { backgroundColor: palette.bgSubtle },
  tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: space[1] },
  title: { ...type.body1Bold, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { ...type.caption, color: palette.textMeta },
});
