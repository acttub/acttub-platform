import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReportRating } from '@/components/report-rating';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
// pen 「오늘 코칭 끝」의 기쁜 액티 — 상태 화면 가운데 크기(84×94)로 둔다.
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { readOptionalPracticeNote } from '@/lib/practice/note';
import type { PracticeNote } from '@/lib/practice/types';

/**
 * 오늘 코칭 끝(pen ⑧ 「오늘 코칭 끝」 TFZ59, SOMA-720) — 배우 일지에서 「저장하기」를 누른 뒤 한 번 보인다.
 *
 * 기쁜 액티 · 「오늘 코칭 끝! 수고했어요.」 · 「일지에 저장했어요」 · 「이 코칭 어땠어요?」(도움 됐어요/아쉬웠어요) · 「홈으로 가기」 ·
 * 「SNS에 공유하기」. 코칭 평가는 배우 일지에서 이 화면으로 옮겼다(pen 메모, 10/19 시안) — 평가는 지금처럼 그 회차의 노트에
 * 남겨(PUT …/note/rating) ops 코칭 노트 평가 집계가 그대로 이어진다. 노트가 없는 회차는 평가 칸을 두지 않는다.
 * 예전 화면의 「다음에 해 볼 것」 카드와 저녁 알림 줄은 이 디자인에 없어 뺐다.
 */
export default function CoachingDoneScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ practiceId?: string; saved?: string }>();
  const practiceId = params.practiceId?.trim() || null;
  const [note, setNote] = useState<PracticeNote | null>(null);

  useEffect(() => {
    if (!practiceId) return;
    let alive = true;
    readOptionalPracticeNote(api.getPracticeNote, practiceId)
      .then((found) => {
        if (alive) setNote(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [practiceId]);

  const share = () => {
    void Share.share({ message: t('journal.shareText') }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={MASCOT.jump} style={MASCOT_SIZE.lg} contentFit="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          {t('journal.endTitle')}
        </Text>
        {params.saved === '1' && <Text style={styles.sub}>{t('journal.endSaved')}</Text>}
        {practiceId && note && (
          <View style={styles.rating}>
            <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />
          </View>
        )}
      </ScrollView>
      <CtaBar safeBottom={false}>
        <PrimaryButton label={t('journal.endHome')} onPress={() => router.replace('/(tabs)')} />
        <Pressable style={styles.share} onPress={share} accessibilityRole="button" ph-label="coaching_done_share">
          <Feather name="share-2" size={16} color={palette.blueDeep} />
          <Text style={styles.shareText}>{t('journal.endShare')}</Text>
        </Pressable>
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', lineHeight: 33, color: palette.text, textAlign: 'center' },
  sub: { fontSize: 14, color: palette.textMuted, textAlign: 'center' },
  rating: { alignSelf: 'stretch', marginTop: 20 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  shareText: { fontSize: 15, fontWeight: '700', color: palette.blueDeep },
});
