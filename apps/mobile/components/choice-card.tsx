import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * 아이콘 칸 색(pen P3.0 「Tile」) — 파랑·노랑·보라. palette 에 아직 없는 값이라 여기 둔다.
 * tile 이 없으면(pen P13.8 「아이콘」) 칸 바탕 없이 아이콘만 그린다.
 */
export const CHOICE_TINT = {
  blue: { tile: '#E3ECFF', icon: '#3B6EF5' },
  amber: { tile: '#FFF3D9', icon: palette.flame },
  violet: { tile: '#EFEAFE', icon: '#7C5CFA' },
  plain: { tile: null, icon: palette.blue },
} as const;

export type ChoiceTint = keyof typeof CHOICE_TINT;

/**
 * 고르는 카드(pen 「선택 규칙」). 기본은 아무것도 고르지 않은 상태이고, 누르면 고른 표시(옅은 파랑 바탕·파란 테두리·체크)가
 * 되며 아래 「다음」을 눌러야 넘어간다. 누르면 바로 넘어가는 줄이 아니다.
 *
 * icon 을 주면 pen P3.0·P3.1·P13.8 모양이 된다 — 왼쪽 아이콘 칸 52, 고르면 파란 동그라미 체크(26),
 * 고르기 전에는 mark 대로 빈 동그라미(radio)나 꺾쇠(chevron)를 보인다.
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
      style={({ pressed }) => [
        styles.card,
        icon && styles.iconCard,
        selected && styles.cardOn,
        pressed && !selected && styles.pressed,
      ]}>
      {icon ? (
        <View style={[styles.tile, colors.tile ? { backgroundColor: colors.tile } : styles.tileBare]}>
          <Feather name={icon} size={colors.tile ? 24 : 20} color={colors.icon} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.title, icon && styles.iconTitle, selected && (icon ? styles.iconTitleOn : styles.titleOn)]}>{title}</Text>
        {sub ? <Text style={[styles.sub, icon && styles.iconSub]}>{sub}</Text> : null}
      </View>
      {icon ? (
        selected ? (
          <View style={styles.checkCircle}>
            <Feather name="check" size={15} color={palette.onAccent} />
          </View>
        ) : mark === 'radio' ? (
          <View style={styles.radio} />
        ) : mark === 'chevron' ? (
          <Feather name="chevron-right" size={20} color={palette.iconFaint} />
        ) : null
      ) : selected ? (
        <Feather name="check" size={22} color={palette.blue} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  // pen P3.0 「평가 받기」 — 모서리 18 · 안쪽 16 · 간격 14, 고르기 전 테두리 1 #E8EDF5.
  iconCard: { borderRadius: 18, paddingVertical: 16, paddingHorizontal: 16, gap: 14, borderWidth: 1, borderColor: '#E8EDF5' },
  cardOn: { borderWidth: 1.5, borderColor: palette.blue, backgroundColor: palette.blueSoft },
  pressed: { backgroundColor: palette.bgSoft },
  tile: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileBare: { width: 40, height: 40, borderRadius: 12 },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 23, color: palette.text },
  titleOn: { color: palette.blueDeep },
  // pen P3.0 — 제목 17/800(고르면 #13205A), 설명 14/400 #6B7684.
  iconTitle: { fontWeight: '800', lineHeight: 24 },
  iconTitleOn: { color: '#13205A' },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textMeta },
  iconSub: { fontWeight: '400', lineHeight: 20, color: palette.textMeta },
  checkCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: palette.border, backgroundColor: palette.bg },
});
