import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import type { Ref } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { palette } from '@/constants/palette';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const IOS = Platform.OS === 'ios';

/**
 * 하단 탭바 공통 부품 — pen 「TabBar」(SOMA-770).
 *
 * iOS: 화면 위에 뜬 흰 알약(좌우 40 — pen 은 폭 350(좌우 20)이지만 SOMA-742 피드백으로 더 좁게 둔다, 높이 64, 모서리 32, 1px #EDF0F3 테두리, 그림자 #191F28 18% · 아래 12 · 흐림 24).
 * 안드로이드: 바닥에 붙은 전체 폭 막대(pen 일반 홈 BTT6at 하단).
 * 아이콘은 활성·비활성 모두 윤곽선(24). 활성은 파랑(palette.blue) + 옅은 파랑 알약(48×34, 모서리 17), 비활성은 회색 #8B95A1 · 바탕 없음.
 * 글자는 iOS 에는 없고, 안드로이드는 활성 탭 아래에만 이름(11/700)을 쓴다(BTT6at). 화면 읽기는 탭마다 이름을 읽는다.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets();
  return IOS
    ? {
        position: 'absolute',
        left: 40,
        right: 40,
        bottom: Math.max(insets.bottom - 14, 12),
        height: 64,
        borderRadius: 32,
        backgroundColor: palette.card,
        borderTopWidth: 0,
        borderWidth: 1,
        borderColor: palette.borderSoft,
        paddingTop: 11,
        paddingBottom: 11,
        shadowColor: palette.navy,
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      }
    : {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 72 + insets.bottom,
        backgroundColor: palette.card,
        borderTopWidth: 0,
        paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        elevation: 16,
      };
}

/** 탭바를 숨긴 모양 — 첫 사용자(연습한 날 없음)는 모든 탭에서 숨긴다(lib/practice/first-time, bHxn1I). */
export const TAB_BAR_HIDDEN: ViewStyle = { display: 'none' };

/** 탭 아이콘 — 위 설명대로. `target`은 첫 가이드가 이 탭을 비출 때 자리를 재는 ref. */
export function tabIcon(
  name: IoniconName,
  label: string,
  target?: { ref: Ref<View>; onLayout: (e: LayoutChangeEvent) => void },
) {
  const TabIcon = ({ color, focused }: { color: string; focused: boolean }) => (
    <View ref={target?.ref} onLayout={target?.onLayout} style={[styles.pill, focused && styles.pillOn]}>
      <Ionicons size={24} name={name} color={color} />
      {!IOS && focused && <Text style={[styles.tabLabel, { color }]}>{label}</Text>}
    </View>
  );
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
  pill: { minWidth: 48, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  pillOn: IOS ? { backgroundColor: palette.blueSoft } : {},
  tabLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
});
