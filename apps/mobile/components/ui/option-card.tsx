import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 고르는 줄 공통 부품(SOMA-770). 디자인의 선택지 모양 셋을 한 파일에 둔다.
 *
 * - OptionCard — pen 「P/OptionCard」: 테두리 #E5E8EB · 모서리 16 · 안쪽 14 · 아이콘 칸 40(파란 18) · 제목 15/800 · 보조 12 · 꺾쇠 18.
 * - IconOptionRow — pen 세션 목적·영상 고르기·코칭/리딩 입구 줄: 테두리 없이 파란 아이콘 22 · 제목 17/700 · 보조 14/500 · 꺾쇠 20.
 *   고르면 옅은 파랑 바탕(#E8F3FF)에 진한 파랑 제목.
 * - SelectRow — pen 온보딩 선택지: 글 17/700, 고르면 옅은 파랑 바탕 + 파란 체크 원(여럿 고르기는 네모).
 */

export function OptionCard({
  icon,
  title,
  sub,
  onPress,
  disabled,
  right,
  phLabel,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
  /** 꺾쇠 대신 둘 것(스피너 등). */
  right?: ReactNode;
  phLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.dim]}>
      <View style={styles.cardIcon}>
        <Feather name={icon} size={18} color={palette.blue} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
      </View>
      {right ?? <Feather name="chevron-right" size={18} color={palette.checkOff} />}
    </Pressable>
  );
}

export function IconOptionRow({
  icon,
  title,
  sub,
  eyebrow,
  selected = false,
  highlight = false,
  mark = 'chevron',
  flush = false,
  disabled,
  onPress,
  phLabel,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  /** 제목 위 파란 안내 한 줄(13/700). */
  eyebrow?: string;
  selected?: boolean;
  /** 권하는 줄 — 고르지 않아도 파랗게. */
  highlight?: boolean;
  /** 오른쪽 표시 — 고르는 목록은 'check'(골랐을 때만), 다음 화면으로 가는 줄은 'chevron'. */
  mark?: 'check' | 'chevron';
  /** 입구 목록처럼 좌우 안쪽 여백을 4로 줄여 글줄과 맞춘다(기본 14). */
  flush?: boolean;
  disabled?: boolean;
  onPress: () => void;
  phLabel?: string;
}) {
  const on = selected || highlight;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      ph-label={phLabel}
      style={({ pressed }) => [styles.row, flush && styles.rowFlush, on && styles.rowOn, pressed && !on && styles.rowPressed]}>
      <View style={styles.iconBox}>
        <Feather name={icon} size={22} color={palette.blue} />
      </View>
      <View style={styles.body}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={[styles.title, on && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {mark === 'check' && selected ? (
        <Feather name="check" size={20} color={palette.blue} />
      ) : (
        <Feather name="chevron-right" size={20} color={palette.textFaint} />
      )}
    </Pressable>
  );
}

export function SelectRow({
  label,
  sub,
  selected,
  onPress,
  multi,
  trailing = 'circle',
}: {
  label: string;
  /** 제목 아래 회색 보조 한 줄(13/500). */
  sub?: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
  /** circle: 빈 원/체크 원(pen 선택지), check: 고른 것에만 체크(pen 성별). */
  trailing?: 'circle' | 'check';
}) {
  const icon: FeatherName | null =
    trailing === 'check' ? (selected ? 'check' : null) : multi ? (selected ? 'check-square' : 'square') : selected ? 'check-circle' : 'circle';
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, selected && styles.optionOn]}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={label}>
      <View style={styles.optionBody}>
        <Text style={[styles.optionText, selected && styles.optionTextOn]}>{label}</Text>
        {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      </View>
      {icon ? <Feather name={icon} size={22} color={selected ? palette.blue : palette.checkOff} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  dim: { opacity: 0.5 },
  cardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  cardSub: { fontSize: 12, fontWeight: '400', color: palette.textFaint },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  rowFlush: { paddingHorizontal: 4 },
  rowOn: { backgroundColor: palette.blueSoft },
  rowPressed: { backgroundColor: palette.bgSubtle },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 6 },
  eyebrow: { fontSize: 13, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },
  title: { fontSize: 17, fontWeight: '700', lineHeight: 25, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { fontSize: 14, fontWeight: '500', lineHeight: 21, color: palette.textMuted },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  optionOn: { backgroundColor: palette.blueSoft, paddingHorizontal: 14 },
  optionBody: { flex: 1, minWidth: 0, gap: 4 },
  optionText: { fontSize: 17, fontWeight: '700', lineHeight: 25, color: palette.text },
  optionTextOn: { color: palette.blueDeep },
  optionSub: { fontSize: 13, fontWeight: '500', lineHeight: 18, color: palette.textFaint },
});
