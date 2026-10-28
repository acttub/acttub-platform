import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** 묶음 안에서의 자리 — 첫 줄은 위가, 끝 줄은 아래가 크게 둥글다(pen 설정 묶음: 18 / 6). */
export type SettingsCardPosition = 'single' | 'first' | 'middle' | 'last';

/**
 * pen 「설정 카드」(S2/SetCard) — 흰 바탕 · 1px #CBD1D8 테두리 · 안쪽 16 · 칸 사이 14.
 * 왼쪽 파란 아이콘(18, 44 칸) · 제목 15.5/800 · 4 띄워 설명 12.5/400 #8B95A1 · 꺾쇠 18.
 * 묶음 안 카드는 사이 6, 모서리는 첫 줄 위 18 · 끝 줄 아래 18 · 나머지 6.
 * `right`를 주면 꺾쇠 대신 그것(스위치 등)을 둔다.
 */
export function SettingsCard({
  icon,
  title,
  sub,
  onPress,
  right,
  iconColor = palette.blue,
  position = 'single',
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  onPress?: (e?: GestureResponderEvent) => void;
  right?: ReactNode;
  iconColor?: string;
  position?: SettingsCardPosition;
}) {
  const body = (
    <>
      <View style={styles.iconCell}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={palette.checkOff} /> : null)}
    </>
  );
  const shape = radiusFor(position);
  if (!onPress) return <View style={[styles.card, shape]}>{body}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, shape, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

function radiusFor(position: SettingsCardPosition) {
  const big = 18;
  const small = 6;
  if (position === 'single') return { borderRadius: big };
  if (position === 'first') return { borderTopLeftRadius: big, borderTopRightRadius: big, borderBottomLeftRadius: small, borderBottomRightRadius: small };
  if (position === 'last') return { borderTopLeftRadius: small, borderTopRightRadius: small, borderBottomLeftRadius: big, borderBottomRightRadius: big };
  return { borderRadius: small };
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.card,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  iconCell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  // 설정 화면 글자를 한 단계 줄였다(SOMA-923).
  title: { fontSize: 14.5, fontWeight: '800', lineHeight: 20, color: palette.text },
  sub: { fontSize: 12, fontWeight: '400', lineHeight: 17, color: palette.textFaint },
});
