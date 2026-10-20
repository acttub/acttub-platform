import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * pen 「NavHeader」(SOMA-770) — 높이 52, 좌우 안쪽 8, 왼쪽 꺾쇠 칸(44), 가운데 제목 17/700, 오른쪽 칸(44), 아래 줄 없음.
 * 기본 헤더(AppHeader)와 자체 헤더를 그리는 화면이 같이 쓴다. 제목은 양쪽 칸 폭과 상관없이 화면 가운데에 둔다.
 * 제목 없이 꺾쇠만 있는 머리(pen 「머리」 — 상태 화면)는 `title`을 비워 둔다.
 */
export function NavHeader({ title, left, right }: { title?: string; left?: ReactNode; right?: ReactNode }) {
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
 * 머리의 아이콘 버튼 한 칸(44×44) — 꺾쇠·닫기·⋯·공유 같은 글자 없는 버튼은 모두 이것을 쓴다.
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
  onPress: () => void;
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

/** NavHeader 왼쪽 칸의 꺾쇠(26) 버튼. */
export function NavBackButton({ onPress, phLabel = 'nav_back' }: { onPress: () => void; phLabel?: string }) {
  return <NavIconButton icon="chevron-left" size={26} label={t('common.back')} phLabel={phLabel} onPress={onPress} />;
}

const styles = StyleSheet.create({
  row: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  // 제목은 양쪽 칸 위에 깔리지 않게 좌우 96 을 비우고 가운데 정렬한다(C/DetailHeader 의 양쪽 칸 폭).
  titleBox: { position: 'absolute', top: 0, bottom: 0, left: 96, right: 96, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: palette.text, textAlign: 'center' },
  side: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
