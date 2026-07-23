import { MaterialIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { palette } from '@/constants/palette';

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
              <MaterialIcons size={24} name="home" color={color} />
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
              <Pressable style={styles.fab} onPress={() => router.push('/upload')}>
                <MaterialIcons name="videocam" size={28} color="#FFFFFF" />
              </Pressable>
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
              <MaterialIcons size={24} name="description" color={color} />
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
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    borderWidth: 4,
    borderColor: palette.card,
    shadowColor: palette.blue,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
