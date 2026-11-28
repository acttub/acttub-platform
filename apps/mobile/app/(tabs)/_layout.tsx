import { Tabs } from 'expo-router';
import React from 'react';

import { tabButton, tabIcon, useTabBarStyle } from '@/components/ui/tab-bar';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { useWarmTabs } from '@/hooks/use-warm-tabs';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { TARGET } from '@/lib/spotlight-targets';

/** 탭 이름(tab_select 의 tab) — 라우트 이름과 같고 홈(index)만 home 이다. */
const TAB_EVENT_NAME: Record<string, string> = {
  index: 'home',
  practice: 'practice',
  challenges: 'challenges',
  community: 'community',
  profile: 'profile',
};

/**
 * 하단 탭 — 홈 / 연습 / 챌린지 / 커뮤니티 / 프로필. 모양은 공통 부품 components/ui/tab-bar.
 *
 * 앱을 열면 홈('/')이 열린다. 연습 탭은 맨 위 「리딩 | 코칭」으로 예전 리딩·코칭 탭을 고른다(app/(tabs)/practice).
 * 게시판은 커뮤니티(community), 챌린지는 예전 라우트(challenges)다 — 챌린지 탭으로 오는 딥링크·푸시가 그대로 열린다(SOMA-1121).
 *
 * iOS 는 글자 없는 아이콘 탭, 안드로이드는 아이콘 아래 탭 이름(디자인 시스템 「의도된 차이」). 탭마다 화면 읽기 이름(tabBarAccessibilityLabel)과
 * 누름 기록 이름(ph-label)을 단다(SOMA-770 피드백 9). 탭을 누르면 tab_select { tab } 을 남긴다.
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle();
  // 읽지 않은 알림 묶음 수 — 커뮤니티 탭 배지(challenge.notification).
  const unread = useUnreadNotifications();
  // 홈 「첫 연습 끝」 안내가 연습·챌린지·프로필 탭을 비춘다 — 탭바는 홈 화면 밖이라 자리를 재서 남겨 둔다(SOMA-748).
  const practiceTarget = useSpotlightTarget(TARGET.tabReading);
  const challengeTarget = useSpotlightTarget(TARGET.tabChallenge);
  const profileTarget = useSpotlightTarget(TARGET.tabProfile);
  // 홈이 뜬 뒤 나머지 탭을 하나씩 뒤에서 미리 만든다 — 처음 눌러도 바로 뜨게(lib/tab-warmup).
  const warm = useWarmTabs();

  // 챌린지 탭은 누름 기록 이름을 예전 그대로(tab_challenge) 둔다 — 지표가 끊기지 않게.
  const tab = (key: 'home' | 'practice' | 'challenge' | 'community' | 'profile') => ({
    title: t(`tabs.${key}`),
    tabBarAccessibilityLabel: t(`tabs.${key}`),
    tabBarButton: tabButton(`tab_${key}`),
  });

  return (
    // 뒤로가기는 들어온 순서대로 돌아간다. 기본값(firstRoute)은 숨긴 탭(지난 연습)에서도 홈으로 보낸다.
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarStyle,
        tabBarShowLabel: false,
        headerShown: false,
      }}
      screenListeners={({ route }) => ({
        tabPress: () => {
          const name = TAB_EVENT_NAME[route.name];
          if (name) logEvent('tab_select', { tab: name });
        },
      })}>
      <Tabs.Screen
        name="index"
        options={{
          ...tab('home'),
          // pen 의 lucide house(선 300)는 Ionicons 에 없어서 pen 에서 꺼낸 그림을 쓴다(SOMA-942).
          tabBarIcon: tabIcon(require('@/assets/images/tab-home.png'), t('tabs.home')),
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{ ...tab('practice'), lazy: !warm.has('practice'), tabBarIcon: tabIcon('book-outline', t('tabs.practice'), { target: practiceTarget }) }}
      />
      <Tabs.Screen
        name="challenges"
        options={{ ...tab('challenge'), lazy: !warm.has('challenges'), tabBarIcon: tabIcon('trophy-outline', t('tabs.challenge'), { target: challengeTarget }) }}
      />
      {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). 공용 Badge 를 아이콘 칸에 단다. */}
      <Tabs.Screen
        name="community"
        options={{
          ...tab('community'),
          lazy: !warm.has('community'),
          tabBarIcon: tabIcon({ feather: 'users' }, t('tabs.community'), { badge: unread.badge }),
        }}
      />
      <Tabs.Screen name="profile" options={{ ...tab('profile'), lazy: !warm.has('profile'), tabBarIcon: tabIcon('person-outline', t('tabs.profile'), { target: profileTarget }) }} />
      {/* 기록·예전 촬영 자리는 탭바에서 빠졌지만 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
      <Tabs.Screen name="history" options={{ href: null }} />
      {/* 예전 리딩·코칭 탭 주소 — 연습 탭의 그쪽으로 넘긴다(서버 공지 버튼·옛 딥링크). */}
      <Tabs.Screen name="reading" options={{ href: null }} />
      <Tabs.Screen name="coaching" options={{ href: null }} />
      <Tabs.Screen name="record" options={{ href: null }} />
    </Tabs>
  );
}
