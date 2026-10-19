import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { LegacyArchivePrompt } from '@/components/legacy-archive-prompt';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { palette } from '@/constants/palette';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { translate as t } from '@/lib/i18n';
import { TARGET } from '@/lib/spotlight-targets';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const IOS = Platform.OS === 'ios';

/**
 * 하단 탭 — 홈 / 코칭 / 대본 / 챌린지 / 프로필(pen TabBar, SOMA-748). 글자 없이 아이콘만.
 *
 * 화면 위에 떠 있는 알약: 좌우·바닥을 띄우고 그림자를 깊게 준다. 아이콘은 Ionicons
 * 아웃라인↔채움 쌍으로, 활성 탭은 채운 모양 + 연한 파란 pill.
 * 예전 가운데 촬영 버튼은 없어지고 코칭은 코칭 탭에서 시작한다. 카메라 화면(record-video)은 코칭·챌린지에서 연다.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // 읽지 않은 알림 묶음 수.
  const unread = useUnreadNotifications();
  // 홈 첫 가이드가 코칭 탭을 비춘다 — 탭바는 홈 화면 밖이라 자리를 재서 남겨 둔다 (SOMA-550).
  const coachingTarget = useSpotlightTarget(TARGET.shoot);

  const icon = (outline: IoniconName, filled: IoniconName, label: string, target?: typeof coachingTarget) => {
    const TabIcon = ({ color, focused }: { color: string; focused: boolean }) => (
      <View
        ref={target?.ref}
        onLayout={target?.onLayout}
        style={[styles.iconPill, IOS && focused && styles.iconPillActive]}>
        <Ionicons size={24} name={focused ? filled : outline} color={color} />
        {!IOS && focused && <Text style={[styles.tabLabel, { color }]}>{label}</Text>}
      </View>
    );
    TabIcon.displayName = `TabIcon(${outline})`;
    return TabIcon;
  };

  return (
    <>
      <LegacyArchivePrompt />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: palette.blue,
          tabBarInactiveTintColor: palette.textFaint,
          // iOS 는 홈 인디케이터 바로 위에 뜬 알약, 안드로이드는 바닥에 붙은 전체 폭 막대(pen 하단 탭 바, SOMA-638).
          tabBarStyle: IOS
            ? {
                position: 'absolute',
                // 좌우를 조금 더 비워 알약을 좁게(SOMA-742 피드백).
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
              },
          tabBarShowLabel: false,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline', 'home', t('tabs.home')) }} />
        <Tabs.Screen
          name="coaching"
          options={{
            title: t('tabs.coaching'),
            tabBarIcon: icon('chatbubble-outline', 'chatbubble', t('tabs.coaching'), coachingTarget),
          }}
        />
        <Tabs.Screen name="reading" options={{ title: t('tabs.reading'), tabBarIcon: icon('book-outline', 'book', t('tabs.reading')) }} />
        {/* 기록·예전 촬영 자리는 탭바에서 빠졌지만 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen name="record" options={{ href: null }} />
        {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). */}
        <Tabs.Screen
          name="challenges"
          options={{
            title: t('tabs.challenge'),
            tabBarIcon: icon('trophy-outline', 'trophy', t('tabs.challenge')),
            tabBarBadge: unread.badge ?? undefined,
          }}
        />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-outline', 'person', t('tabs.profile')) }} />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    minWidth: 48,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  iconPillActive: {
    backgroundColor: palette.blueSoft,
  },
  tabLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
});
