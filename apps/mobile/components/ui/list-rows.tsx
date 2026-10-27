import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 설정·목록 화면이 같이 쓰는 줄 모양들(SOMA-770 공통).
 * pen 「설정 및 활동」「알림 설정」「동의 내역」「온보딩 선택지」의 수치를 그대로 옮겼다.
 */

/** 설정 구역 이름 — 13/700 회색. */
export function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionLabelText}>{label}</Text>
    </View>
  );
}

/** 구역 사이 4px 연회색 띠. */
export function SectionGap() {
  return <View style={styles.sectionGap} />;
}

/**
 * 설정 한 줄 — 아이콘 22 · 제목 15/600 · (값 14/500) · 꺾쇠 또는 스위치.
 * `danger`면 빨간 글자만(로그아웃). `right`를 주면 꺾쇠 대신 그것을 둔다.
 */
export function ListRow({
  icon,
  iconNode,
  title,
  value,
  onPress,
  right,
  danger,
}: {
  icon?: FeatherName;
  /** Feather 에 없는 그림(반짝이 등)을 쓸 때. 22px 로 그려 넘긴다. */
  iconNode?: ReactNode;
  title: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
}) {
  const body = (
    <>
      {iconNode ?? (icon ? <Feather name={icon} size={22} color={palette.text} /> : null)}
      <Text style={[styles.rowTitle, danger && styles.rowDanger]} numberOfLines={1}>
        {title}
      </Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right ?? (onPress && !danger ? <Feather name="chevron-right" size={20} color={palette.iconFaint} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

/** 앱 공통 스위치 — pen 「Switch/On」·「Switch/Off」: 켜짐 blue, 꺼짐 text-disabled. */
export function BlueSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ true: palette.blue, false: palette.textDisabled }}
      thumbColor={palette.onAccent}
      ios_backgroundColor={palette.textDisabled}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** 두 줄(제목 15/700 · 보조 13/500)짜리 줄 — 알림 설정·동의 내역. 높이 60. */
export function TwoLineRow({
  title,
  sub,
  right,
  onPress,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View style={styles.twoLineText}>
        <Text style={styles.twoLineTitle}>{title}</Text>
        {sub ? <Text style={styles.twoLineSub}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={20} color={palette.iconFaint} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.twoLine}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.twoLine, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { paddingTop: 6, paddingBottom: 2 },
  sectionLabelText: { fontSize: 13, fontWeight: '700', lineHeight: 18, color: palette.textMeta },
  sectionGap: { height: 4, backgroundColor: palette.bgSubtle, marginVertical: 4 },
  row: { minHeight: 33, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.6 },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 21, color: palette.text },
  rowDanger: { color: palette.danger },
  rowValue: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: palette.textMeta },
  twoLine: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  twoLineText: { flex: 1, minWidth: 0 },
  twoLineTitle: { fontSize: 15, fontWeight: '700', lineHeight: 21, color: palette.text },
  twoLineSub: { fontSize: 13, fontWeight: '500', lineHeight: 18, color: palette.textMeta },
});
