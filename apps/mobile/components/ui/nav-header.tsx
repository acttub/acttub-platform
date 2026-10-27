import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 화면 머리 — 디자인 시스템 pen 「NavHeader」. 높이 44, 안쪽 좌우 4, 왼쪽·오른쪽 44 칸, 가운데 제목 headline.
 * 오른쪽에 할 일이 없어도 44 칸을 비워 두어 제목이 화면 가운데에 머문다. 제목 없이 꺾쇠만 있는 머리는 `title`을 비운다.
 * `large`는 탭 첫 화면 머리(NavHeader/Large) — 높이 72, 안쪽 좌우 20, 왼쪽 제목 display.
 */
export function NavHeader({
  title,
  left,
  right,
  large,
}: {
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  large?: boolean;
}) {
  if (large) {
    return (
      <View style={styles.large}>
        {left}
        <Text style={styles.largeTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {title ? (
        <View style={styles.titleBox} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      <View style={styles.side}>{left}</View>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

/**
 * 머리의 아이콘 버튼 한 칸(44×44, 아이콘 22) — 꺾쇠·닫기·⋯·공유 같은 글자 없는 버튼은 모두 이것을 쓴다.
 * 글자가 없으니 읽어 줄 이름(`label`)과 누름 기록 이름(`phLabel`)을 꼭 받는다.
 */
export function NavIconButton({
  icon,
  label,
  phLabel,
  onPress,
  color = palette.text,
  size = 22,
  disabled,
}: {
  icon: FeatherName;
  label: string;
  phLabel: string;
  /** ⋯ 메뉴는 누른 자리 아래에 띄우려고 이벤트를 받는다. */
  onPress: (e: GestureResponderEvent) => void;
  color?: string;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      ph-label={phLabel}>
      <Feather name={icon} size={size} color={color} />
    </Pressable>
  );
}

/** 머리 왼쪽 칸의 꺾쇠(26). 나가기처럼 뜻이 다른 꺾쇠는 `label`을 바꾼다. */
export function NavBackButton({
  onPress,
  phLabel = 'nav_back',
  label = t('common.back'),
  disabled,
}: {
  onPress: () => void;
  phLabel?: string;
  label?: string;
  disabled?: boolean;
}) {
  return <NavIconButton icon="chevron-left" size={26} label={label} phLabel={phLabel} onPress={onPress} disabled={disabled} />;
}

const SIDE = 44;

const styles = StyleSheet.create({
  row: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[1] },
  // 양쪽 칸 폭과 상관없이 화면 가운데에 둔다. 제목이 칸 위에 깔리지 않게 좌우를 비운다(오른쪽 칸이 두 개인 머리까지).
  titleBox: { position: 'absolute', top: 0, bottom: 0, left: SIDE * 2 + space[1], right: SIDE * 2 + space[1], alignItems: 'center', justifyContent: 'center' },
  title: { ...type.headline, color: palette.text, textAlign: 'center' },
  side: { minWidth: SIDE, height: SIDE, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  icon: { width: SIDE, height: SIDE, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  large: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[5] },
  largeTitle: { ...type.display, flex: 1, color: palette.text },
});
