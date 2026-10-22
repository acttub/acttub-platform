import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * pen 「설정 카드」(파이프라인 반영버전) — 흰 바탕 · 1px #E5E8EB 테두리 · 모서리 22 · 안쪽 [12,14,12,15] · 칸 사이 13.
 * 왼쪽 아이콘 원(38, #EAF3FE, 아이콘 20) · 제목 17/800(줄 21) · 5 띄워 설명 13.5/400(줄 16) #8B95A1 · 꺾쇠 20.
 * `right`를 주면 꺾쇠 대신 그것(스위치 등)을 둔다.
 */
export function SettingsCard({
  icon,
  title,
  sub,
  onPress,
  right,
  iconColor = palette.blue,
}: {
  icon: FeatherName;
  title: string;
  sub: string;
  onPress?: () => void;
  right?: ReactNode;
  iconColor?: string;
}) {
  const body = (
    <>
      <View style={styles.iconCircle}>
        <Feather name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={20} color={palette.checkOff} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    paddingLeft: 15,
    paddingRight: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 21, color: palette.text },
  sub: { fontSize: 13.5, fontWeight: '400', lineHeight: 16, color: palette.textFaint },
});
