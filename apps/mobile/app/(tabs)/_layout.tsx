import { Tabs } from 'expo-router';
import React from 'react';

import { TAB_BAR_HIDDEN, tabButton, tabIcon, useTabBarStyle } from '@/components/ui/tab-bar';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { translate as t } from '@/lib/i18n';
import { TARGET } from '@/lib/spotlight-targets';

/**
 * 하단 탭 — 홈 / 코칭 / 대본 / 챌린지 / 프로필(pen TabBar, SOMA-748·770). 모양은 공통 부품 components/ui/tab-bar.
 *
 * iOS 는 글자 없는 아이콘 탭, 안드로이드는 아이콘 아래 탭 이름(디자인 시스템 「의도된 차이」). 탭마다 화면 읽기 이름(tabBarAccessibilityLabel)과
 * 누름 기록 이름(ph-label)을 단다(SOMA-770 피드백 9).
 * 예전 가운데 촬영 버튼은 없어지고 코칭은 코칭 탭에서 시작한다. 카메라 화면(record-video)은 코칭·챌린지에서 연다.
 * 첫 사용자(홈 「뭐부터 해 볼까요?」 기준 — 묶음·대본·연습한 날이 모두 없음)로 확인되면 모든 탭에서 탭바를 숨기고, 무엇이든 시작하면 다시 보인다(bHxn1I, SOMA-781).
 * 판단은 홈이 받은 기록으로 lib/practice/first-time 한 곳에서 한다. 아직 모르면(홈을 거치지 않고 다른 탭으로 들어온 경우) 보인다.
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle();
  const firstTime = useFirstTimeUser();
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
      {/* 뒤로가기는 들어온 순서대로 돌아간다. 기본값(firstRoute)은 숨긴 탭(지난 연습)에서도 홈으로 보낸다. */}
      <Tabs
        backBehavior="history"
        screenOptions={{
          tabBarStyle: firstTime ? TAB_BAR_HIDDEN : tabBarStyle,
          tabBarShowLabel: false,
          headerShown: false,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            ...tab('home'),
            tabBarIcon: tabIcon('home-outline', t('tabs.home')),
          }}
        />
        <Tabs.Screen
          name="coaching"
          options={{ ...tab('coaching'), tabBarIcon: tabIcon('chatbubble-outline', t('tabs.coaching'), { target: coachingTarget }) }}
        />
        <Tabs.Screen name="reading" options={{ ...tab('reading'), tabBarIcon: tabIcon('book-outline', t('tabs.reading'), { target: readingTarget }) }} />
        {/* 기록·예전 촬영 자리는 탭바에서 빠졌지만 라우트는 남겨 다른 화면에서 접근 가능하게 둔다. */}
        <Tabs.Screen name="history" options={{ href: null }} />
        <Tabs.Screen name="record" options={{ href: null }} />
        {/* 배지는 읽지 않은 알림 묶음 수다(challenge.notification). 공용 Badge 를 아이콘 칸에 단다. */}
        <Tabs.Screen
          name="challenges"
          options={{
            ...tab('challenge'),
            tabBarIcon: tabIcon('trophy-outline', t('tabs.challenge'), { target: challengeTarget, badge: unread.badge }),
          }}
        />
        <Tabs.Screen name="profile" options={{ ...tab('profile'), tabBarIcon: tabIcon('person-outline', t('tabs.profile'), { target: profileTarget }) }} />
      </Tabs>
    </>
  );
}
