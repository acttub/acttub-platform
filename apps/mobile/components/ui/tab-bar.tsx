import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import type { Ref } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { palette } from '@/constants/palette';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * 하단 탭바 공통 부품 — pen 「하단 탭 바」(파이프라인 반영버전).
 *
 * iOS·안드로이드 모두 바닥에 붙은 전체 폭 흰 막대: 높이 61.5(+홈 인디케이터·시스템 내비게이션 칸), 위 1px #F2F4F6 줄,
 * 안쪽 [8,12,0,12]. (예전 iOS 의 뜬 알약(SOMA-742)은 새 디자인에서 없앴다.)
 * 아이콘은 활성·비활성 모두 윤곽선 22. 활성은 파랑 #4880EE, 비활성은 회색 #8B95A1.
 * 글자는 활성 탭 아래에만 이름(12/700, 줄 15, 아이콘과 2 띄움)을 쓴다. 화면 읽기는 탭마다 이름을 읽는다.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets();
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: TAB_BAR_HEIGHT + insets.bottom,
    backgroundColor: palette.card,
    borderTopWidth: 1,
    borderTopColor: palette.bgSoft,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: insets.bottom,
    elevation: 0,
    shadowOpacity: 0,
  };
}

/** 탭바 높이(홈 인디케이터 칸 제외). */
export const TAB_BAR_HEIGHT = 61.5;

/** 탭바를 숨긴 모양 — 첫 사용자(연습한 날 없음)는 모든 탭에서 숨긴다(lib/practice/first-time, bHxn1I). */
export const TAB_BAR_HIDDEN: ViewStyle = { display: 'none' };

/** 탭 아이콘 — 위 설명대로. `target`은 첫 가이드가 이 탭을 비출 때 자리를 재는 ref. */
export function tabIcon(
  name: IoniconName,
  label: string,
  target?: { ref: Ref<View>; onLayout: (e: LayoutChangeEvent) => void },
) {
  const TabIcon = ({ color, focused }: { color: string; focused: boolean }) => (
    <View ref={target?.ref} onLayout={target?.onLayout} style={styles.item}>
      <Ionicons size={22} name={name} color={color} />
      {focused && <Text style={[styles.tabLabel, { color }]}>{label}</Text>}
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
  item: { width: 48, minHeight: 39, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  tabLabel: { fontSize: 12, fontWeight: '700', lineHeight: 15 },
});
