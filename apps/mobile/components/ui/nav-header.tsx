import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * pen 「헤더 / 가운데 제목」(파이프라인 반영버전) — 높이 44, 아이콘(24)은 좌우 끝에서 14, 가운데 제목 18/800, 아래 줄 없음.
 * 아이콘 버튼 칸은 누르기 쉽게 44 로 두고 그림 자리만 14 에 맞춘다(좌우 안쪽 4 + 칸 안 여백 10).
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

/** NavHeader 왼쪽 칸의 꺾쇠(24) 버튼. */
export function NavBackButton({ onPress, phLabel = 'nav_back' }: { onPress: () => void; phLabel?: string }) {
  return <NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel={phLabel} onPress={onPress} />;
}

/** 칸 없이 그림(24)만 있는 꺾쇠 — 꺾쇠 옆에 바로 글이 붙는 머리(뒤로+제목·온보딩 진행)에 쓴다. 누르는 범위는 hitSlop 으로 넓힌다. */
export function BareBackButton({
  onPress,
  label = t('common.back'),
  phLabel = 'nav_back',
  disabled,
}: {
  onPress: () => void;
  label?: string;
  phLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={label}
      ph-label={phLabel}>
      <Feather name="chevron-left" size={24} color={palette.text} />
    </Pressable>
  );
}

/**
 * pen 「헤더 / 뒤로+제목」 — 높이 44, 안쪽 [0,16,0,12], 꺾쇠 24 옆 7 띄워 제목 17/700(왼쪽 정렬). 약관 동의 같은 단계 화면.
 * `back`을 주면 기본 꺾쇠 대신 그것을 둔다(나가기 이름·막힘이 다른 꺾쇠).
 */
export function BackTitleHeader({ title, onBack, back }: { title: string; onBack?: () => void; back?: ReactNode }) {
  return (
    <View style={styles.backTitle}>
      {back ?? (onBack ? <BareBackButton onPress={onBack} /> : null)}
      <Text style={styles.backTitleText} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

/** pen 「헤더 / 큰 제목」 — 높이 72, 안쪽 [0,28], (꺾쇠 24 ·) 제목 28/800 · 오른쪽 아이콘. 탭 첫 화면 머리. */
export function LargeTitleHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.large}>
      {onBack ? <BareBackButton onPress={onBack} /> : null}
      <Text style={styles.largeTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.flex} />
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  // 제목은 양쪽 칸 위에 깔리지 않게 좌우 96 을 비우고 가운데 정렬한다(C/DetailHeader 의 양쪽 칸 폭).
  titleBox: { position: 'absolute', top: 0, bottom: 0, left: 96, right: 96, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: palette.text, textAlign: 'center' },
  side: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  backTitle: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 12, paddingRight: 16 },
  backTitleText: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: palette.text },
  large: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 28 },
  largeTitle: { fontSize: 28, fontWeight: '800', color: palette.text },
  flex: { flex: 1 },
});
