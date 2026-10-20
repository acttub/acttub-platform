import { Tabs } from 'expo-router';
import React from 'react';

import { LegacyArchivePrompt } from '@/components/legacy-archive-prompt';
import { TAB_BAR_HIDDEN, tabButton, tabIcon, useHomeTabBarHidden, useTabBarStyle } from '@/components/ui/tab-bar';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { palette } from '@/constants/palette';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { translate as t } from '@/lib/i18n';
import { TARGET } from '@/lib/spotlight-targets';

/**
 * 하단 탭 — 홈 / 코칭 / 대본 / 챌린지 / 프로필(pen TabBar, SOMA-748·770). 모양은 공통 부품 components/ui/tab-bar.
 *
 * 글자 없는 아이콘 탭이라 탭마다 화면 읽기 이름(tabBarAccessibilityLabel)과 누름 기록 이름(ph-label)을 단다(SOMA-770 피드백 9).
 * 예전 가운데 촬영 버튼은 없어지고 코칭은 코칭 탭에서 시작한다. 카메라 화면(record-video)은 코칭·챌린지에서 연다.
 * 홈 첫 사용자 화면(뭐부터 해 볼까요?)에서는 홈 탭에서만 탭바를 숨긴다(bHxn1I).
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle();
  const homeHidden = useHomeTabBarHidden();
  // 읽지 않은 알림 묶음 수.
  const unread = useUnreadNotifications();
  // 홈 첫 가이드가 코칭 탭을 비춘다 — 탭바는 홈 화면 밖이라 자리를 재서 남겨 둔다 (SOMA-550).
  const coachingTarget = useSpotlightTarget(TARGET.shoot);
  const readingTarget = useSpotlightTarget(TARGET.tabReading);
  const challengeTarget = useSpotlightTarget(TARGET.tabChallenge);
  const profileTarget = useSpotlightTarget(TARGET.tabProfile);

  const tab = (key: 'home' | 'coaching' | 'reading' | 'challenge' | 'profile') => ({
    title: t(`tabs.${key}`),
    tabBarAccessibilityLabel: t(`tabs.${key}`),
    tabBarButton: tabButton(`tab_${key}`),
  });

  return (
    <>
      <LegacyArchivePrompt />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: palette.blue,
          tabBarInactiveTintColor: palette.textFaint,
          tabBarStyle,
          tabBarShowLabel: false,
          headerShown: false,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            ...tab('home'),
            tabBarIcon: tabIcon('home-outline', t('tabs.home')),
            tabBarStyle: homeHidden ? TAB_BAR_HIDDEN : tabBarStyle,
          }}
        />
        <Tabs.Screen
          name="coaching"
          options={{ ...tab('coaching'), tabBarIcon: tabIcon('chatbubble-outline', t('tabs.coaching'), coachingTarget) }}
        />
        <Tabs.Screen name="reading" options={{ ...tab('reading'), tabBarIcon: tabIcon('book-outline', t('tabs.reading'), readingTarget) }} />
        {/* 기록·예전 촬영 자리는 탭바에서 빠졌지만 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen name="record" options={{ href: null }} />
        {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). */}
        <Tabs.Screen
          name="challenges"
          options={{
            ...tab('challenge'),
            tabBarIcon: tabIcon('trophy-outline', t('tabs.challenge'), challengeTarget),
            tabBarBadge: unread.badge ?? undefined,
          }}
        />
        <Tabs.Screen name="profile" options={{ ...tab('profile'), tabBarIcon: tabIcon('person-outline', t('tabs.profile'), profileTarget) }} />
      </Tabs>
    </>
  );
}
