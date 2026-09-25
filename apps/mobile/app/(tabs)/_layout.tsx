import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { LegacyArchivePrompt } from '@/components/legacy-archive-prompt';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { palette } from '@/constants/palette';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { isKorean, translate as t } from '@/lib/i18n';
import { TARGET } from '@/lib/spotlight-targets';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * 하단 탭 — 홈 / 대본 / [촬영(FAB)] / 챌린지 / 프로필. 글자 없이 아이콘만(pen 탭바).
 *
 * 화면 위에 떠 있는 알약: 좌우·바닥을 띄우고 그림자를 깊게 준다. 아이콘은 Ionicons
 * 아웃라인↔채움 쌍으로, 활성 탭은 채운 모양 + 연한 파란 pill.
 * 촬영 버튼은 카메라를 바로 연다(인스타 만들기 화면처럼) — 용도(AI 코칭 / 오늘의 대사 / 그냥 촬영)는
 * 셔터 아래 줄을 넘겨 고른다(SOMA-494). 찍은 것은 보관함에 남아야 해서 둘러보는 중이면 로그인부터 안내한다.
 */
export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 읽지 않은 알림 묶음 수 — 챌린지가 열린 사람에게만 읽는다.
  const unread = useUnreadNotifications(isKorean());
  // 첫 가이드가 이 버튼을 비춘다 — 탭바는 홈 화면 밖이라 자리를 재서 남겨 둔다 (SOMA-550).
  const shootTarget = useSpotlightTarget(TARGET.shoot);

  const openCamera = () => {
    router.push({ pathname: '/record-video', params: { mode: 'ai', picker: '1' } });
  };

  const icon = (outline: IoniconName, filled: IoniconName) => {
    const TabIcon = ({ color, focused }: { color: string; focused: boolean }) => (
      <View style={[styles.iconPill, focused && styles.iconPillActive]}>
        <Ionicons size={24} name={focused ? filled : outline} color={color} />
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
          tabBarStyle: {
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: insets.bottom + 16,
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
            elevation: 14,
          },
          tabBarShowLabel: false,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline', 'home') }} />
        <Tabs.Screen name="reading" options={{ title: t('tabs.reading'), tabBarIcon: icon('book-outline', 'book') }} />
        {/* 기록은 탭바에서 빠졌지만(대본으로 교체) 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen
          name="record"
          options={{
            title: '',
            tabBarButton: () => (
              <View style={styles.fabSlot}>
                <Pressable
                  ref={shootTarget.ref}
                  onLayout={shootTarget.onLayout}
                  style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t('tabs.shootA11y')}
                  onPress={openCamera}>
                  <Ionicons name="videocam" size={26} color="#FFFFFF" />
                </Pressable>
              </View>
            ),
          }}
        />
        {/* 대사 챌린지에 올라오는 대사가 전부 한국어라, 한국어로 쓰는 사람에게만 띄운다 (SOMA-544). */}
        {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). */}
        <Tabs.Screen
          name="challenges"
          options={
            isKorean()
              ? {
                  title: t('tabs.challenge'),
                  tabBarIcon: icon('trophy-outline', 'trophy'),
                  tabBarBadge: unread.badge ?? undefined,
                }
              : { href: null }
          }
        />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person-outline', 'person') }} />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    minWidth: 48,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  iconPillActive: {
    backgroundColor: palette.blueSoft,
  },
  fabSlot: { flex: 1, alignItems: 'center' },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    borderWidth: 4,
    borderColor: palette.card,
    shadowColor: palette.blue,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabPressed: { transform: [{ scale: 0.96 }] },
});
