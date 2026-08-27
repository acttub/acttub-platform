import Feather from '@expo/vector-icons/Feather';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/**
 * 하단 탭 — 홈 / 기록 / [촬영(FAB)] / 게시판 / 프로필.
 * 가운데 버튼이 무슨 버튼인지 모르겠다는 피드백이 있어 아이콘 아래 라벨을 붙였다.
 * 아이콘은 Feather(라인) 한 세트로 통일한다 — MaterialIcons 기본 채움 아이콘은 톤이 안 맞는다.
 *
 * 다섯 칸이 되면서 알약 하나에 돌아가는 폭이 좁아졌다. 아이콘 알약 minWidth를
 * 44로 줄이고 라벨을 두 글자로 맞춰, 좁은 기기(iPhone SE 375pt)에서도 글자가
 * 줄바꿈되지 않게 했다.
 */
export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.blue,
        tabBarInactiveTintColor: palette.textFaint,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 12,
          height: 66,
          borderRadius: 33,
          backgroundColor: palette.card,
          borderTopWidth: 0,
          paddingTop: 8,
          paddingBottom: 10,
          shadowColor: palette.navy,
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Feather size={21} name="home" color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Feather size={21} name="file-text" color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={styles.fabSlot}>
              <Pressable
                style={styles.fab}
                accessibilityRole="button"
                accessibilityLabel={t('tabs.shootA11y')}
                onPress={() => router.push('/upload')}>
                <Feather name="video" size={24} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.fabLabel}>{t('tabs.shoot')}</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: t('tabs.community'),
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Feather size={21} name="message-square" color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Feather size={21} name="user" color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    minWidth: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  iconPillActive: {
    backgroundColor: palette.blueSoft,
  },
  fabSlot: { flex: 1, alignItems: 'center' },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    borderWidth: 4,
    borderColor: palette.card,
    shadowColor: palette.blue,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabLabel: { fontSize: 11, fontWeight: '700', color: palette.blue, marginTop: 3 },
});
