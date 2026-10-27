import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 고르는 줄 공통 부품(SOMA-770). 디자인의 선택지 모양 셋을 한 파일에 둔다.
 *
 * - OptionCard — pen 「P/OptionCard」: 테두리 #E5E8EB · 모서리 16 · 안쪽 14 · 아이콘 칸 40(파란 18) · 제목 15/800 · 보조 12 · 꺾쇠 18.
 * - IconOptionRow — pen 「선택 카드」(세션 목적·영상 고르기·코칭/리딩 입구 줄): 테두리 없이 안쪽 [13,14,13,19] · 모서리 16,
 *   파란 아이콘 24 · 21 띄워 제목 18/700(줄 23) · 4 띄워 보조 16/500(줄 21) #8B95A1 · 꺾쇠 22.
 *   고르면 옅은 파랑 바탕(#EAF3FE)에 진한 파랑 제목.
 * - SelectRow — pen 「온보딩 / 선택 행」·「체크 행」: 높이 49, 글 17/700, 오른쪽 라디오 18(테두리 1.5 #B0B8C1)
 *   또는 여럿 고르기는 체크 칸 16(모서리 2). 고르면 파랑으로 찬다.
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
      {right ?? <Feather name="chevron-right" size={18} color={palette.textDisabled} />}
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
  /** 오른쪽 표시 — 고르는 목록은 'check'(골랐을 때만), 다음 화면으로 가는 줄은 'chevron', 누르면 바로 넘어가는 줄은 'none'(SOMA-778). */
  mark?: 'check' | 'chevron' | 'none';
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
        <Feather name={icon} size={24} color={palette.blue} />
      </View>
      <View style={styles.body}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={[styles.title, on && styles.titleOn]}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {mark === 'none' ? null : mark === 'check' && selected ? (
        <Feather name="check" size={22} color={palette.blue} />
      ) : (
        <Feather name="chevron-right" size={22} color={palette.iconFaint} />
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
  /** circle: 라디오·체크 칸(pen 선택 행·체크 행), check: 고른 것에만 체크 표시. */
  trailing?: 'circle' | 'check';
}) {
  let mark: ReactNode = null;
  if (trailing === 'check') mark = selected ? <Feather name="check" size={20} color={palette.blue} /> : null;
  else if (multi)
    mark = (
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected ? <Feather name="check" size={12} color={palette.onAccent} /> : null}
      </View>
    );
  else mark = <View style={[styles.radio, selected && styles.radioOn]} />;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, multi && styles.optionCheck, pressed && styles.optionPressed]}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={label}>
      <View style={styles.optionBody}>
        <Text style={[styles.optionText, selected && styles.optionTextOn]}>{label}</Text>
        {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      </View>
      {mark}
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
    backgroundColor: palette.bg,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  dim: { opacity: 0.5 },
  cardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  cardSub: { fontSize: 12, fontWeight: '400', color: palette.textMeta },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 21,
    paddingVertical: 13,
    paddingLeft: 19,
    paddingRight: 14,
    borderRadius: 16,
  },
  rowFlush: { paddingLeft: 4, paddingRight: 4 },
  rowOn: { backgroundColor: palette.blueSoft },
  rowPressed: { backgroundColor: palette.bgSubtle },
  iconBox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { fontSize: 13, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },
  title: { fontSize: 18, fontWeight: '700', lineHeight: 23, color: palette.text },
  titleOn: { color: palette.blueDeep },
  sub: { fontSize: 16, fontWeight: '500', lineHeight: 21, color: palette.textMeta },

  option: {
    minHeight: 49,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingLeft: 5,
    paddingRight: 4,
  },
  optionCheck: { paddingRight: 5 },
  optionPressed: { opacity: 0.6 },
  optionBody: { flex: 1, minWidth: 0, gap: 4 },
  optionText: { fontSize: 17, fontWeight: '700', color: palette.text },
  optionTextOn: { color: palette.blueDeep },
  optionSub: { fontSize: 13, fontWeight: '500', lineHeight: 18, color: palette.textMeta },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: palette.textDisabled },
  radioOn: { borderWidth: 5, borderColor: palette.blue },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: palette.textDisabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: palette.blue, borderColor: palette.blue },
});
