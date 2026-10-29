import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import type { Ref } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Badge } from '@/components/ui/badge';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { palette } from '@/constants/palette';
import { shadowOverlay, space, type } from '@/constants/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const IOS = Platform.OS === 'ios';
// 디자인 시스템 「의도된 차이」 — iOS 고른 탭 알약은 text 8% 회색이다(24색 밖, 탭바에서만).
const IOS_PILL = '#191F2814';
const IOS_BAR = 64;
const ITEM = 56;

/**
 * 하단 탭바 — 디자인 시스템 pen 「TabBar」. 플랫폼마다 일부러 다르다(DESIGN-SYSTEM.md 「의도된 차이」).
 *
 * iOS: 화면 위에 뜬 알약(좌우 20, 높이 64, 모서리 32, 안쪽 4, shadow-overlay). 글자 없이 아이콘 26, 고른 탭은 칸을 채우는 회색 알약.
 *   견본의 반투명 바탕 + 흐림 24 는 흐림 모듈(expo-blur)이 앱에 없어 흰 바탕 + 1px `border` 로 둔다.
 * 안드로이드: 바닥에 붙은 막대(위 1px `border`). 아이콘 22 아래 탭 이름(micro), 고른 탭은 알약 없이 `blue-deep`.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets();
  return IOS
    ? {
        position: 'absolute',
        // 라이브러리 기본 start·end: 0 이 left·right 를 이겨서 start·end 로 준다.
        start: space.gutter,
        end: space.gutter,
        bottom: Math.max(insets.bottom - 14, 12),
        height: IOS_BAR,
        borderRadius: IOS_BAR / 2,
        backgroundColor: palette.bg,
        borderTopWidth: 0,
        borderWidth: 1,
        borderColor: palette.border,
        paddingTop: space[1],
        paddingBottom: space[1],
        paddingHorizontal: space[1],
        ...shadowOverlay,
      }
    : {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: space[2] + ITEM + space[2] + insets.bottom,
        backgroundColor: palette.bg,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        paddingTop: space[2],
        paddingBottom: space[2] + insets.bottom,
        paddingHorizontal: space[2],
        elevation: 0,
      };
}

/**
 * 탭 화면 맨 아래에 비워 둘 높이. 탭바는 두 플랫폼 모두 화면 위에 떠 있어서(absolute) 탭 화면의 마지막 내용·하단 버튼이 그 밑에
 * 깔린다. 보일 때는 탭바가 차지하는 높이 + 12, 첫 사용자로 숨길 때는 홈 표시줄 높이만 비운다. 탭 화면은 숫자를 따로 적지 말고
 * 이 값을 쓴다(10/22 피드백 — 화면마다 100~140 을 적어 기기에 따라 버튼이 가렸다).
 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const firstTime = useFirstTimeUser();
  if (firstTime) return insets.bottom;
  return IOS ? Math.max(insets.bottom - 14, 12) + IOS_BAR + space[3] : space[2] + ITEM + space[2] + insets.bottom + space[3];
}

/** 탭바를 숨긴 모양 — 첫 사용자(연습한 날 없음)는 모든 탭에서 숨긴다(lib/practice/first-time, bHxn1I). */
export const TAB_BAR_HIDDEN: ViewStyle = { display: 'none' };

/**
 * 탭 아이콘 — 위 설명대로. 안드로이드는 아이콘 아래에 `label`을 둔다. `badge`가 있으면 공용 Badge 를 칸 오른쪽 위에 단다.
 * `target`은 첫 가이드가 이 탭을 비출 때 자리를 재는 ref.
 */
export function tabIcon(
  name: IoniconName,
  label: string,
  { target, badge }: { target?: { ref: Ref<View>; onLayout: (e: LayoutChangeEvent) => void }; badge?: string | null } = {},
) {
  const TabIcon = ({ focused }: { focused: boolean }) => {
    const color = IOS ? (focused ? palette.text : palette.textSub) : focused ? palette.blueDeep : palette.iconFaint;
    return (
      <View ref={target?.ref} onLayout={target?.onLayout} style={[styles.item, IOS && focused && styles.itemOn]}>
        <Ionicons size={IOS ? 26 : 22} name={name} color={color} />
        {/* 안드로이드는 지금 들어가 있는 탭만 이름을 보인다(10/23 결정, 10/28 대표 재확인). 다른 탭은 자리만 남겨 아이콘 높이를 맞춘다. */}
        {IOS ? null : (
          <Text style={[styles.label, focused ? styles.labelOn : styles.labelHidden]} importantForAccessibility="no">
            {label}
          </Text>
        )}
        {badge ? <Badge label={badge} style={styles.badge} /> : null}
      </View>
    );
  };
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
}

/** 탭 버튼 — 누를 때 가벼운 진동(iOS)과 누름 기록 이름(ph-label). */
export function tabButton(phLabel: string) {
  const TabButton = (props: BottomTabBarButtonProps) => <HapticTab {...props} ph-label={phLabel} />;
  TabButton.displayName = `TabButton(${phLabel})`;
  return TabButton;
}

const styles = StyleSheet.create({
  item: IOS
    ? { width: 70, height: ITEM, borderRadius: ITEM / 2, alignItems: 'center', justifyContent: 'center' }
    : { width: 72, height: ITEM, gap: 2, alignItems: 'center', justifyContent: 'center' },
  itemOn: { backgroundColor: IOS_PILL },
  label: { ...type.micro, color: palette.textMeta },
  labelOn: { color: palette.blueDeep },
  labelHidden: { opacity: 0 },
  badge: { position: 'absolute', top: space[1.5], left: '50%', marginLeft: space[2] },
});
