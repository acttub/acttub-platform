import Feather from '@expo/vector-icons/Feather';
import { type ComponentProps, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';

export type MenuAnchor = { x: number; y: number };

const MARGIN = 12;
const GAP = 8;

/** 누른 이벤트에서 화면 좌표(pageX/pageY)를 뽑는다. 좌표가 없으면 undefined(오른쪽 위에 뜬다). */
export function pt(e?: GestureResponderEvent): MenuAnchor | undefined {
  const n = e?.nativeEvent;
  if (!n || typeof n.pageX !== 'number' || typeof n.pageY !== 'number') return undefined;
  return { x: n.pageX, y: n.pageY };
}

/** 누른 점(anchor, 화면 좌표) 아래·위에 화면 밖으로 나가지 않게 메뉴 자리를 정한다. anchor 가 없으면 오른쪽 위. */
export function placeMenu(
  anchor: MenuAnchor | undefined,
  size: { width: number; height: number },
  screen: { width: number; height: number },
  insets: { top: number; bottom: number },
) {
  const width = Math.min(size.width, screen.width - MARGIN * 2);
  if (!anchor) return { left: screen.width - width - 16, top: insets.top + 56, width };
  const left = Math.min(Math.max(anchor.x - width / 2, MARGIN), screen.width - width - MARGIN);
  const maxBottom = screen.height - insets.bottom - MARGIN;
  let top = anchor.y + GAP;
  if (top + size.height > maxBottom) top = anchor.y - size.height - GAP;
  top = Math.min(Math.max(top, insets.top + MARGIN), Math.max(insets.top + MARGIN, maxBottom - size.height));
  return { left, top, width };
}

/** 메뉴 항목 높이와 카드 안쪽 위아래 — 메뉴 높이를 어림할 때 쓴다(목소리 고르기 메뉴, SOMA-886). */
export const MENU_ITEM_HEIGHT = 44;
export const MENU_PAD = space[1.5];

/**
 * 누른 자리 근처에 뜨는 작은 메뉴(아래 시트 대신). 어두운 배경 없이 투명 오버레이만 깔고, 바깥을 누르면 닫힌다.
 * 높이는 항목 수로 어림해 자리를 잡는다(estimatedHeight).
 */
export function AnchoredMenu({
  anchor,
  width = 220,
  estimatedHeight,
  onClose,
  children,
}: {
  anchor?: MenuAnchor;
  width?: number;
  estimatedHeight: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pos = placeMenu(anchor, { width, height: estimatedHeight }, screen, insets);
  return (
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          testID="anchored-menu"
          style={[styles.card, { left: pos.left, top: pos.top, width: pos.width }]}
          onPress={(e) => e.stopPropagation()}>
          <View accessibilityViewIsModal>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 메뉴 항목 한 줄 — 높이 44, 좌우 16. `destructive`는 빨간 글자, `selected`는 진파랑 글자 + 오른쪽 체크. */
export function MenuItem({
  label,
  onPress,
  destructive,
  selected,
  icon,
  badge,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
  icon?: ComponentProps<typeof Feather>['name'];
  badge?: string;
}) {
  const color = destructive ? palette.danger : selected ? palette.blueDeep : palette.text;
  return (
    <Pressable
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}>
      {icon ? <Feather name={icon} size={18} color={color} /> : null}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      {selected ? <Feather name="check" size={18} color={palette.blue} style={styles.check} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  card: {
    position: 'absolute',
    backgroundColor: palette.card,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  item: { minHeight: MENU_ITEM_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space[1.5], paddingHorizontal: space[4] },
  pressed: { backgroundColor: palette.bgSoft },
  label: { ...type.body2Bold, flexShrink: 1 },
  check: { marginLeft: 'auto' },
  badge: { ...type.micro, color: palette.blueDeep, backgroundColor: palette.blueSoft, borderRadius: radius.full, overflow: 'hidden', paddingHorizontal: space[2], paddingVertical: 2 },
});
