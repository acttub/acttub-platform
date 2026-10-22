import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import type { Ref } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { palette } from '@/constants/palette';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const IOS = Platform.OS === 'ios';

/**
 * 하단 탭바 공통 부품 — pen 「TabBar」(SOMA-770).
 *
 * iOS: 화면 위에 뜬 흰 알약(좌우 20 — pen TabBar 폭 350, 높이 64, 모서리 32, 1px #EDF0F3 테두리, 그림자 #191F28 18% · 아래 12 · 흐림 24).
 * 안드로이드: 바닥에 붙은 전체 폭 막대(pen 일반 홈 BTT6at 하단).
 * 아이콘은 활성·비활성 모두 윤곽선(24). 활성은 파랑(palette.blue) + 옅은 파랑 알약(48×34, 모서리 17), 비활성은 회색 #8B95A1 · 바탕 없음.
 * 다섯 탭 모두 아이콘 아래에 이름(11/600, 활성은 파랑 700)을 쓴다 — 선택한 탭에만 이름이 보여 다른 탭이 뭔지 몰랐다(10/20 피드백).
 * 화면 읽기도 탭마다 이름을 읽는다.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets();
  return IOS
    ? {
        position: 'absolute',
        // 라이브러리 기본 start·end: 0 이 left·right 를 이겨서 start·end 로 준다.
        start: 20,
        end: 20,
        bottom: Math.max(insets.bottom - 14, 12),
        height: 64,
        borderRadius: 32,
        backgroundColor: palette.card,
        borderTopWidth: 0,
        borderWidth: 1,
        borderColor: palette.borderSoft,
        paddingTop: 6,
        paddingBottom: 6,
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

/**
 * 탭 화면 맨 아래에 비워 둘 높이. 탭바는 두 플랫폼 모두 화면 위에 떠 있어서(absolute) 탭 화면의 마지막 내용·하단 버튼이 그 밑에
 * 깔린다. 보일 때는 탭바가 차지하는 높이 + 12, 첫 사용자로 숨길 때는 홈 표시줄 높이만 비운다. 탭 화면은 숫자를 따로 적지 말고
 * 이 값을 쓴다(10/22 피드백 — 화면마다 100~140 을 적어 기기에 따라 버튼이 가렸다).
 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const firstTime = useFirstTimeUser();
  if (firstTime) return insets.bottom;
  return IOS ? Math.max(insets.bottom - 14, 12) + 64 + 12 : 72 + insets.bottom + 12;
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
    <View ref={target?.ref} onLayout={target?.onLayout} style={styles.item}>
      <View style={[styles.pill, focused && styles.pillOn]}>
        <Ionicons size={22} name={name} color={color} />
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelOn, { color }]} numberOfLines={1}>
        {label}
      </Text>
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
  item: { minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  pill: { minWidth: 44, minHeight: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  pillOn: IOS ? { backgroundColor: palette.blueSoft } : {},
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '600', marginTop: 2 },
  tabLabelOn: { fontWeight: '700' },
});
