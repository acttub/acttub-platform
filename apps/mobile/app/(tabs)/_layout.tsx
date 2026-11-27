import { Tabs } from 'expo-router';
import React from 'react';

import { TabLaunchOverlays } from '@/components/tab-launch-overlays';
import { tabButton, tabIcon, useTabBarStyle } from '@/components/ui/tab-bar';
import { PracticeRecordsProvider } from '@/hooks/use-practice-records';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { useWarmTabs } from '@/hooks/use-warm-tabs';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { isTabName, rememberLastTab } from '@/lib/last-tab';

/**
 * 하단 탭 — 리딩 / 코칭 / 커뮤니티 / 챌린지 / 프로필(SOMA-1120). 모양은 공통 부품 components/ui/tab-bar.
 *
 * 홈 탭은 없다. '/'(index)는 탭 바에 보이지 않고 마지막에 쓴 탭으로 넘기는 길이다(app/(tabs)/index, lib/last-tab).
 * 홈이 하던 기록 읽기·첫 사용자 판정은 PracticeRecordsProvider, 연속일 축하·첫 사용자 안내·공지 포스터·안드로이드 뒤로가기는
 * TabLaunchOverlays 가 탭 묶음 위에서 맡는다.
 *
 * iOS 는 글자 없는 아이콘 탭, 안드로이드는 아이콘 아래 탭 이름(디자인 시스템 「의도된 차이」). 탭마다 화면 읽기 이름(tabBarAccessibilityLabel)과
 * 누름 기록 이름(ph-label)을 단다(SOMA-770 피드백 9). 탭을 누르면 tab_select { tab }, 탭이 보이면 마지막 탭으로 남긴다.
 * 게시판은 커뮤니티(community), 챌린지는 예전 라우트(challenges)다 — 챌린지 탭으로 오는 딥링크·푸시가 그대로 열린다(SOMA-1121).
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle();
  // 읽지 않은 알림 묶음 수 — 커뮤니티 탭 배지(challenge.notification).
  const unread = useUnreadNotifications();
  // 앱이 뜬 뒤 나머지 탭을 하나씩 뒤에서 미리 만든다 — 처음 눌러도 바로 뜨게(lib/tab-warmup).
  const warm = useWarmTabs();

  // 챌린지 탭은 누름 기록 이름을 예전 그대로(tab_challenge) 둔다 — 지표가 끊기지 않게.
  const tab = (key: 'reading' | 'coaching' | 'community' | 'challenge' | 'profile') => ({
    title: t(`tabs.${key}`),
    tabBarAccessibilityLabel: t(`tabs.${key}`),
    tabBarButton: tabButton(`tab_${key}`),
  });

  return (
    <PracticeRecordsProvider>
      {/* 뒤로가기는 들어온 순서대로 돌아간다. 기본값(firstRoute)은 숨긴 탭(지난 연습)에서도 첫 탭으로 보낸다. */}
      <Tabs
        backBehavior="history"
        screenOptions={{
          tabBarStyle,
          tabBarShowLabel: false,
          headerShown: false,
        }}
        screenListeners={({ route }) => ({
          tabPress: () => {
            if (isTabName(route.name)) logEvent('tab_select', { tab: route.name });
          },
          focus: () => {
            if (isTabName(route.name)) void rememberLastTab(route.name);
          },
        })}>
        {/* '/' — 마지막에 쓴 탭으로 넘기는 길. 탭 바에는 없다. */}
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="reading" options={{ ...tab('reading'), lazy: !warm.has('reading'), tabBarIcon: tabIcon('book-outline', t('tabs.reading')) }} />
        <Tabs.Screen name="coaching" options={{ ...tab('coaching'), lazy: !warm.has('coaching'), tabBarIcon: tabIcon('chatbubble-outline', t('tabs.coaching')) }} />
        {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). 공용 Badge 를 아이콘 칸에 단다. */}
        <Tabs.Screen
          name="community"
          options={{
            ...tab('community'),
            lazy: !warm.has('community'),
            tabBarIcon: tabIcon({ feather: 'users' }, t('tabs.community'), { badge: unread.badge }),
          }}
        />
        <Tabs.Screen name="challenges" options={{ ...tab('challenge'), lazy: !warm.has('challenges'), tabBarIcon: tabIcon('trophy-outline', t('tabs.challenge')) }} />
        <Tabs.Screen name="profile" options={{ ...tab('profile'), lazy: !warm.has('profile'), tabBarIcon: tabIcon('person-outline', t('tabs.profile')) }} />
        {/* 기록·예전 촬영 자리는 탭바에서 빠졌지만 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen name="record" options={{ href: null }} />
      </Tabs>
      <TabLaunchOverlays />
    </PracticeRecordsProvider>
  );
}
