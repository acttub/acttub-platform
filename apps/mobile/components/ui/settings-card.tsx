import Feather from '@expo/vector-icons/Feather';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/**
 * 테두리 카드 줄 — 화면 pen 「ListRow/Card」(설정·알림 설정). 흰 바탕 · 1px `border` · r-lg · 안쪽 16 · 칸 사이 12.
 * 왼쪽 아이콘 20(`text-sub`). 제목 body1-bold · 2 띄워 설명 caption `text-meta`.
 * 오른쪽은 꺾쇠 18(`icon-faint`), `right`를 주면 그것(스위치 등)을 둔다.
 */
export function SettingsCard({
  icon,
  title,
  sub,
  onPress,
  right,
}: {
  icon: FeatherName;
  title: string;
  sub?: string;
  onPress?: (e?: GestureResponderEvent) => void;
  right?: ReactNode;
}) {
  const body = (
    <>
      {/* 원형 아이콘 바탕은 쓰지 않는다(UX 가이드 6절 「칸칸」 금지). */}
      <Feather name={icon} size={20} color={palette.textSub} />
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

/**
 * 설정 묶음 하나 — 제목과 줄들. 줄 사이에만 구분선을 넣는다(디자인 시스템 ListRow 「구분선」: 섹션 맨 위·아래와 섹션 사이에는 넣지 않는다).
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {Children.toArray(children).map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={styles.divider} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...type.captionBold, color: palette.textSub, marginBottom: space[1] },
  divider: { height: 1, backgroundColor: palette.border },
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
