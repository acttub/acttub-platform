import { Feather } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { palette } from '@/constants/palette';

/**
 * 하단 탭 — 홈 / 기록 / [연습(FAB)] / 설정.
 * 가운데 버튼이 무슨 버튼인지 모르겠다는 피드백이 있어 아이콘 아래 '연습' 라벨을 붙였다.
 * 아이콘은 Feather(라인) 한 세트로 통일한다 — MaterialIcons 기본 채움 아이콘은 톤이 안 맞는다.
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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '홈',
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
          title: '기록',
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
                accessibilityLabel="연습 시작"
                onPress={() => router.push('/upload')}>
                <Feather name="video" size={24} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.fabLabel}>연습</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconPill, focused && styles.iconPillActive]}>
              <Feather size={21} name="settings" color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    minWidth: 52,
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
