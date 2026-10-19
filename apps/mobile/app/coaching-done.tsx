import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';

const MASCOT = require('@/assets/images/mascot-cheer.png');

/**
 * 코칭 마무리(pen 「새 · 코칭 마무리」, SOMA-748) — 배우 일지에서 「저장하고 마치기」를 누른 뒤 한 번 보인다.
 * 노트의 「다음에 해 볼 것」을 다시 보여 주고, 확인을 누르면 홈으로 간다.
 *
 * 알림 줄은 저녁 리마인드가 켜져 있을 때만 보인다. 서버 리마인드(account.notification)는 연습을 쉰 날 저녁 8시에
 * 정해진 문구로 가므로 숙제 내용으로 보낸다고 말하지 않는다 — 디자인의 「이걸로 알려 드릴게요」와 다르다.
 */
export default function CoachingDoneScreen() {
  const router = useRouter();
  const next = useLocalSearchParams<{ next?: string }>().next?.trim() || null;
  const [reminder, setReminder] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .notificationSettings()
      .then((settings) => {
        if (alive) setReminder(settings.evening_reminder);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.badge}>
          <Feather name="check-circle" size={16} color={palette.green} />
          <Text style={styles.badgeText}>{t('note.doneBadge')}</Text>
        </View>
        <View style={styles.head}>
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.title}>{next ? t('note.doneTitle') : t('note.doneTitleNoNext')}</Text>
        </View>
        {next && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{t('note.doneNextLabel')}</Text>
            <Text style={styles.cardText}>{next}</Text>
          </View>
        )}
        {reminder && (
          <View style={styles.reminder}>
            <Feather name="bell" size={18} color={palette.blue} />
            <Text style={styles.reminderText}>{t('note.doneReminder')}</Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.bottom}>
        <PrimaryButton label={t('note.doneConfirm')} onPress={() => router.replace('/(tabs)')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 24, gap: 16 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.greenSoft,
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeText: { fontSize: 13, fontWeight: '800', color: palette.green },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mascot: { width: 52, height: 58 },
  title: { flex: 1, fontSize: 21, fontWeight: '800', lineHeight: 30, color: palette.text },
  card: { backgroundColor: palette.bgSoft, borderRadius: 18, padding: 16, gap: 6 },
  cardLabel: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  cardText: { fontSize: 16, fontWeight: '800', lineHeight: 24, color: palette.text },
  reminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.blueSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  reminderText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.blueDeep },
  bottom: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10 },
});
