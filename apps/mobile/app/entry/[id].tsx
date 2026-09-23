import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { browseFailure } from '@/lib/challenge/browse';
import { translate as t } from '@/lib/i18n';

/**
 * 참여작 공유 링크로 들어오는 자리(challenge.react).
 *
 * 회원 앱에서 열면 노출 조건을 서버가 확인한 뒤 그 참여작부터 피드를 연다. 그 사이 비공개·삭제·
 * 숨김이 됐거나 차단 관계면 404 라 "볼 수 없는 영상" 안내만 한다(웹 공개 페이지는 없다).
 */
export default function EntryLinkScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError(t('react.linkGone'));
      return;
    }
    let alive = true;
    void api
      .getEntry(id)
      .then((entry) => {
        if (!alive) return;
        router.replace({ pathname: '/challenge-play', params: { id: entry.challenge_id, entryId: entry.id } });
      })
      .catch((e) => {
        if (!alive) return;
        const failure = browseFailure(e);
        setError(failure.kind === 'not_found' ? t('react.linkGone') : t('challenges.loadFail'));
      });
    return () => {
      alive = false;
    };
  }, [id, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        {!error ? (
          <ActivityIndicator color={palette.blue} />
        ) : (
          <>
            <Text style={styles.message}>{error}</Text>
            <Pressable style={styles.cta} onPress={() => router.replace('/challenges')} accessibilityRole="button">
              <Text style={styles.ctaText}>{t('challenges.title')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 28 },
  message: { fontSize: 15, color: palette.textDim, textAlign: 'center', lineHeight: 23 },
  cta: { backgroundColor: palette.blue, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13 },
  ctaText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
