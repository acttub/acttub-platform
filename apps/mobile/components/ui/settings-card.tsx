import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 테두리 카드 줄 — 화면 pen 「ListRow/Card」(설정·알림 설정). 흰 바탕 · 1px `border` · r-lg · 안쪽 16 · 칸 사이 12.
 * 왼쪽 아이콘 20(`text-sub`), `iconCircle`이면 40 `blue-soft` 원 안 `blue-deep` 아이콘. 제목 body1-bold · 2 띄워 설명 caption `text-meta`.
 * 오른쪽은 꺾쇠 18(`icon-faint`), `right`를 주면 그것(스위치 등)을 둔다.
 */
export function SettingsCard({
  icon,
  title,
  sub,
  onPress,
  right,
  iconCircle,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  onPress?: (e?: GestureResponderEvent) => void;
  right?: ReactNode;
  iconCircle?: boolean;
}) {
  const body = (
    <>
      {/* 원형 아이콘 바탕은 쓰지 않는다(UX 가이드 6절 「칸칸」 금지). iconCircle 은 예전 호출과의 호환용이다. */}
      <Feather name={icon} size={20} color={iconCircle ? palette.blueDeep : palette.textSub} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={palette.iconFaint} /> : null)}
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
  // 테두리 상자 없는 줄(UX 가이드 6절, 10/16·10/18 — 목록·메뉴 줄마다 상자를 씌우지 않는다).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    minHeight: 56,
    borderRadius: radius.sm,
    backgroundColor: palette.bg,
  },
  pressed: { backgroundColor: palette.bgSubtle },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.body1Bold, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta },
});
